// SixM Link : relie SixM à VIctory sans modifier ni l'un ni l'autre.
//
// Côté SixM, il joue le rôle du bridge (integrations/victory/PROTOCOL.md) sur 127.0.0.1.
// Côté jeu, il dessine une surcouche (chat, joueurs, radar) au-dessus de la fenêtre de VIctory.
// Il ne lit et n'écrit jamais la mémoire du jeu : la position du joueur lui est donc inconnue.
//
// Compilé sur la machine par client/link.js avec le csc.exe de Windows (C# 5).
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

static class Program
{
    public const int PortTaken = 4;
    public static StreamWriter Out;

    [STAThread]
    static int Main(string[] args)
    {
        Native.SetProcessDPIAware();
        Application.EnableVisualStyles();
        // Programme sans console : Console.OutputEncoding échouerait, on ouvre les flux nous-mêmes.
        Out = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        Out.AutoFlush = true;
        if (args.Length == 2 && args[0] == "--pick") return Pick(args[1]);
        if (args.Length == 2 && args[0] == "--pick-folder") return PickFolder(args[1]);
        int port;
        if (args.Length != 2 || args[0] != "--serve" || !int.TryParse(args[1], out port)) return 2;

        Bridge bridge = new Bridge();
        try { port = bridge.Start(port); }
        catch (SocketException e)
        {
            if (e.SocketErrorCode == SocketError.AddressAlreadyInUse || e.SocketErrorCode == SocketError.AccessDenied) return PortTaken;
            throw;
        }
        Overlay overlay = new Overlay(bridge);
        IntPtr handle = overlay.Handle; // créé sur ce fil, avant les appels des autres fils

        Thread input = new Thread(delegate()
        {
            string line;
            StreamReader reader = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            while ((line = reader.ReadLine()) != null)
                if (line.StartsWith("dump ")) { string file = line.Substring(5); overlay.BeginInvoke((Action)delegate { overlay.Dump(file); }); }
            Environment.Exit(0); // SixM a disparu
        });
        input.IsBackground = true;
        input.Start();
        Out.WriteLine("ready " + port);
        Application.Run();
        return 0;
    }

    static int PickFolder(string title)
    {
        using (FolderBrowserDialog d = new FolderBrowserDialog())
        using (Form owner = new Form())
        {
            owner.TopMost = true;
            d.Description = title;
            d.ShowNewFolderButton = false;
            if (d.ShowDialog(owner) != DialogResult.OK) return 3;
            Out.Write(d.SelectedPath);
            return 0;
        }
    }

    static int Pick(string title)
    {
        using (OpenFileDialog d = new OpenFileDialog())
        using (Form owner = new Form())
        {
            owner.TopMost = true; // devant la fenêtre de SixM
            d.Title = title;
            d.Filter = "Programme (*.exe)|*.exe";
            if (d.ShowDialog(owner) != DialogResult.OK) return 3;
            Out.Write(d.FileName);
            return 0;
        }
    }
}

sealed class Remote { public string Name; public double X, Y, Z; }
sealed class Line { public string Text; public DateTime At; }

/// Serveur NDJSON local, un seul client à la fois.
sealed class Bridge
{
    const int MaxLine = 1 << 20;
    public readonly object Lock = new object();
    public readonly Dictionary<int, Remote> Remotes = new Dictionary<int, Remote>();
    public readonly List<string> Players = new List<string>();
    public readonly List<Line> Lines = new List<Line>();
    public string Server = "";
    public int TargetPid;
    public double[] View; // clip = m * (x, y, z, 1), par lignes
    public DateTime ViewAt;
    public bool HasSelf;
    public double SelfX, SelfY, SelfZ;
    public int Version; // change à chaque modification visible

    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    TcpListener listener;
    TcpClient client;
    StreamWriter writer;

    public int Start(int port)
    {
        listener = new TcpListener(IPAddress.Loopback, port);
        listener.ExclusiveAddressUse = true;
        listener.Start();
        Thread t = new Thread(AcceptLoop);
        t.IsBackground = true;
        t.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    void AcceptLoop()
    {
        for (;;)
        {
            TcpClient c = listener.AcceptTcpClient();
            lock (Lock) { if (client != null) { c.Close(); continue; } client = c; }
            Thread t = new Thread(delegate() { Serve(c); });
            t.IsBackground = true;
            t.Start();
        }
    }

    void Serve(TcpClient c)
    {
        try
        {
            c.NoDelay = true;
            c.SendTimeout = 1000;
            NetworkStream stream = c.GetStream();
            lock (Lock)
            {
                // Chaque client renvoie son état complet.
                Clear();
                writer = new StreamWriter(stream, new UTF8Encoding(false));
                writer.NewLine = "\n";
            }
            Dictionary<string, object> hello = new Dictionary<string, object>();
            hello["t"] = "ready";
            hello["build"] = "sixm-link";
            Send(hello);
            StreamReader reader = new StreamReader(stream, new UTF8Encoding(false));
            StringBuilder sb = new StringBuilder();
            int ch;
            while ((ch = reader.Read()) >= 0)
            {
                if (ch != '\n') { if (sb.Length >= MaxLine) return; sb.Append((char)ch); continue; }
                string line = sb.ToString();
                sb.Length = 0;
                // Une page web qui tenterait un POST HTTP ici est coupée dès sa première ligne.
                Dictionary<string, object> m;
                try { m = json.Deserialize<Dictionary<string, object>>(line); } catch (Exception) { return; }
                if (m == null) return;
                lock (Lock) { if (Handle(m)) Version++; }
            }
        }
        catch (IOException) { }
        catch (ObjectDisposedException) { }
        finally
        {
            c.Close();
            lock (Lock) { client = null; writer = null; Clear(); }
        }
    }

    void Clear()
    {
        Remotes.Clear(); Players.Clear(); Lines.Clear();
        Server = ""; TargetPid = 0; View = null; HasSelf = false; Version++;
    }

    bool Handle(Dictionary<string, object> m)
    {
        switch (Str(m, "t", 16))
        {
            case "setRemote":
                {
                    int id = (int)Num(m, "id");
                    if (Remotes.Count >= 1024 && !Remotes.ContainsKey(id)) return false;
                    Remote r = new Remote();
                    r.Name = Str(m, "name", 24);
                    r.X = Num(m, "x"); r.Y = Num(m, "y"); r.Z = Num(m, "z");
                    Remotes[id] = r;
                    return true;
                }
            case "removeRemote": Remotes.Remove((int)Num(m, "id")); return true;
            case "log":
                {
                    Line l = new Line();
                    l.Text = Str(m, "text", 300);
                    l.At = DateTime.UtcNow;
                    Lines.Add(l);
                    if (Lines.Count > 8) Lines.RemoveAt(0);
                    return true;
                }
            case "roster":
                {
                    Server = Str(m, "server", 64);
                    Players.Clear();
                    object list;
                    System.Collections.IList items = m.TryGetValue("players", out list) ? list as System.Collections.IList : null;
                    if (items != null)
                        foreach (object o in items)
                            if (o is string && Players.Count < 1024) Players.Add(Clean((string)o, 24));
                    return true;
                }
            case "view":
                {
                    object raw;
                    System.Collections.IList list = m.TryGetValue("m", out raw) ? raw as System.Collections.IList : null;
                    if (list == null || list.Count != 16) return false;
                    double[] v = new double[16];
                    for (int i = 0; i < 16; i++)
                    {
                        if (!(list[i] is int || list[i] is decimal || list[i] is double || list[i] is long)) return false;
                        v[i] = Convert.ToDouble(list[i]);
                    }
                    View = v;
                    ViewAt = DateTime.UtcNow;
                    HasSelf = m.ContainsKey("x") && m.ContainsKey("y") && m.ContainsKey("z");
                    SelfX = Num(m, "x"); SelfY = Num(m, "y"); SelfZ = Num(m, "z");
                    return false; // redessiné par Markers, pas par le panneau
                }
            case "target": TargetPid = (int)Num(m, "pid"); return true;
            default: return false;
        }
    }

    public void SendChat(string text)
    {
        Dictionary<string, object> m = new Dictionary<string, object>();
        m["t"] = "chat";
        m["text"] = text;
        Send(m);
    }

    void Send(object m)
    {
        string text = new JavaScriptSerializer().Serialize(m);
        lock (Lock)
        {
            if (writer == null) return;
            try { writer.WriteLine(text); writer.Flush(); } catch (IOException) { } catch (ObjectDisposedException) { }
        }
    }

    static string Str(Dictionary<string, object> m, string k, int max)
    {
        object v;
        return m.TryGetValue(k, out v) && v is string ? Clean((string)v, max) : "";
    }

    static double Num(Dictionary<string, object> m, string k)
    {
        object v;
        if (!m.TryGetValue(k, out v) || !(v is int || v is decimal || v is double || v is long)) return 0;
        double d = Convert.ToDouble(v);
        return d > -2e9 && d < 2e9 ? d : 0;
    }

    static string Clean(string s, int max)
    {
        StringBuilder sb = new StringBuilder();
        foreach (char c in s) { if (sb.Length == max) break; sb.Append(char.IsControl(c) ? ' ' : c); }
        return sb.ToString();
    }
}

/// Panneau transparent aux clics, posé sur la fenêtre du jeu. F8 : écrire, F9 : masquer.
sealed class Overlay : Form
{
    const int ChatKey = 1, HideKey = 2, PanelWidth = 360, PanelHeight = 460;
    readonly Bridge bridge;
    readonly ChatBox chat;
    readonly Markers markers;
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    readonly Font font = new Font("Segoe UI", 10.5f), bold = new Font("Segoe UI Semibold", 10.5f), small = new Font("Segoe UI", 8.5f);
    IntPtr target;
    bool keys, hidden, drawn;
    int version = -1;
    Point place;

    public Overlay(Bridge b)
    {
        bridge = b;
        chat = new ChatBox(b);
        markers = new Markers(b);
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        timer.Interval = 100;
        timer.Tick += delegate { Follow(); };
        timer.Start();
    }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams p = base.CreateParams;
            p.ExStyle |= 0x80000 | 0x20 | 0x08000000 | 0x80 | 0x8; // LAYERED TRANSPARENT NOACTIVATE TOOLWINDOW TOPMOST
            return p;
        }
    }

    protected override bool ShowWithoutActivation { get { return true; } }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == 0x312) // WM_HOTKEY
        {
            if ((int)m.WParam == ChatKey) chat.Open(new Point(place.X, place.Y + PanelHeight), target);
            else { hidden = !hidden; Follow(); }
        }
        base.WndProc(ref m);
    }

    void Follow()
    {
        int pid, v;
        lock (bridge.Lock) { pid = bridge.TargetPid; v = bridge.Version; }
        target = pid == 0 ? IntPtr.Zero : Native.MainWindow(pid);
        IntPtr front = Native.GetForegroundWindow();
        // Pendant une bascule de focus, Windows n'a aucune fenêtre active : on garde l'état.
        if (front == IntPtr.Zero && target != IntPtr.Zero) return;
        bool inGame = target != IntPtr.Zero && !Native.IsIconic(target) && (front == target || (chat.Visible && Native.IsOurs(front)));
        markers.Follow(inGame && !hidden ? target : IntPtr.Zero);
        // Raccourcis pris seulement quand le jeu est au premier plan, pour ne pas les voler aux autres programmes.
        if (inGame != keys)
        {
            keys = inGame;
            if (inGame) { Native.RegisterHotKey(Handle, ChatKey, 0x4000, 0x77); Native.RegisterHotKey(Handle, HideKey, 0x4000, 0x78); }
            else { Native.UnregisterHotKey(Handle, ChatKey); Native.UnregisterHotKey(Handle, HideKey); }
        }
        if (!inGame || hidden)
        {
            if (Visible) Hide();
            if (!inGame && chat.Visible) chat.Hide();
            drawn = false;
            return;
        }
        Native.POINT at = new Native.POINT();
        Native.ClientToScreen(target, ref at);
        Point next = new Point(at.X + 16, at.Y + 16);
        bool moved = next != place;
        place = next;
        bool fading;
        lock (bridge.Lock) fading = bridge.Lines.Count > 0 && (DateTime.UtcNow - bridge.Lines[bridge.Lines.Count - 1].At).TotalSeconds < 16;
        if (!Visible) Show();
        if (moved || v != version || !drawn || fading) { version = v; drawn = true; Present(); }
    }

    public void Dump(string file)
    {
        using (Bitmap b = Render()) b.Save(file, ImageFormat.Png);
        int shown;
        using (Bitmap m = markers.Render(1280, 720, out shown)) m.Save(file + ".markers.png", ImageFormat.Png);
        Program.Out.WriteLine("dumped visible=" + (Visible ? 1 : 0) + " target=" + (target != IntPtr.Zero ? 1 : 0) + " markers=" + shown);
    }

    Bitmap Render()
    {
        Bitmap b = new Bitmap(PanelWidth, PanelHeight, PixelFormat.Format32bppPArgb);
        using (Graphics g = Graphics.FromImage(b))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            lock (bridge.Lock)
            {
                string title = bridge.Server.Length > 0 ? bridge.Server : "SixM";
                Panel(g, 0, 0, 220, 34 + Math.Min(bridge.Players.Count, 8) * 20);
                Label(g, title, bold, Color.White, 12, 6, 196);
                for (int i = 0; i < bridge.Players.Count && i < 8; i++)
                {
                    string name = i == 7 && bridge.Players.Count > 8 ? "… et " + (bridge.Players.Count - 7) + " autres" : bridge.Players[i];
                    Label(g, name, font, Color.FromArgb(230, 235, 232), 12, 28 + i * 20, 196);
                }
                if (bridge.Remotes.Count > 0) Radar(g, 230, 0, 120);
                float y = PanelHeight - 20;
                Panel(g, 0, (int)y - 2, 150, 20);
                Label(g, "F8 écrire   F9 masquer", small, Color.White, 8, y, 300);
                for (int i = bridge.Lines.Count - 1; i >= 0; i--)
                {
                    double age = (DateTime.UtcNow - bridge.Lines[i].At).TotalSeconds;
                    if (age > 15) continue;
                    int alpha = age < 12 ? 255 : (int)(255 * (15 - age) / 3);
                    SizeF size = g.MeasureString(bridge.Lines[i].Text, font, PanelWidth - 20);
                    float h = Math.Min(size.Height, 60) + 6;
                    y -= h + 3;
                    if (y < 205) break;
                    using (SolidBrush back = new SolidBrush(Color.FromArgb(alpha * 165 / 255, 16, 20, 18))) g.FillRectangle(back, 0, y, Math.Min(size.Width + 20, PanelWidth), h);
                    using (SolidBrush ink = new SolidBrush(Color.FromArgb(alpha, 255, 255, 255))) g.DrawString(bridge.Lines[i].Text, font, ink, new RectangleF(8, y + 3, PanelWidth - 18, h));
                }
            }
        }
        return b;
    }

    void Radar(Graphics g, int x, int y, int size)
    {
        // Sans position locale, le radar est centré sur le groupe.
        double cx = 0, cy = 0, range = 25;
        foreach (Remote r in bridge.Remotes.Values) { cx += r.X / bridge.Remotes.Count; cy += r.Y / bridge.Remotes.Count; }
        foreach (Remote r in bridge.Remotes.Values) range = Math.Max(range, Math.Max(Math.Abs(r.X - cx), Math.Abs(r.Y - cy)));
        Panel(g, x, y, size, size);
        using (SolidBrush dot = new SolidBrush(Color.FromArgb(79, 182, 140)))
            foreach (Remote r in bridge.Remotes.Values)
                g.FillEllipse(dot, (float)(x + size / 2 + (r.X - cx) / range * size * 0.42) - 4, (float)(y + size / 2 - (r.Y - cy) / range * size * 0.42) - 4, 8, 8);
    }

    static void Panel(Graphics g, int x, int y, int w, int h)
    {
        using (SolidBrush b = new SolidBrush(Color.FromArgb(165, 16, 20, 18))) g.FillRectangle(b, x, y, w, h);
    }

    static void Label(Graphics g, string s, Font f, Color c, float x, float y, float w)
    {
        using (SolidBrush b = new SolidBrush(c))
        using (StringFormat format = new StringFormat(StringFormatFlags.NoWrap))
        {
            format.Trimming = StringTrimming.EllipsisCharacter;
            g.DrawString(s, f, b, new RectangleF(x, y, w, 22), format);
        }
    }

    void Present()
    {
        using (Bitmap b = Render()) Native.Layer(Handle, b, place.X, place.Y);
    }
}

/// Noms des autres joueurs, placés dans le monde quand la caméra du jeu est connue.
sealed class Markers : Form
{
    readonly Bridge bridge;
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    readonly Font font = new Font("Segoe UI Semibold", 10.5f);
    IntPtr target;

    public Markers(Bridge b)
    {
        bridge = b;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        timer.Interval = 33;
        timer.Tick += delegate { Draw(); };
        timer.Start();
    }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams p = base.CreateParams;
            p.ExStyle |= 0x80000 | 0x20 | 0x08000000 | 0x80 | 0x8;
            return p;
        }
    }

    protected override bool ShowWithoutActivation { get { return true; } }

    public void Follow(IntPtr window) { target = window; }

    /// Position à l'écran d'un point du monde, ou false s'il est hors champ.
    static bool Project(double[] m, double x, double y, double z, double w, double h, out float sx, out float sy)
    {
        double cx = m[0] * x + m[1] * y + m[2] * z + m[3], cy = m[4] * x + m[5] * y + m[6] * z + m[7], cw = m[12] * x + m[13] * y + m[14] * z + m[15];
        sx = sy = 0;
        if (!(cw > 0.01)) return false; // derrière la caméra
        double nx = cx / cw, ny = cy / cw;
        if (!(Math.Abs(nx) <= 1.2 && Math.Abs(ny) <= 1.2)) return false;
        sx = (float)((nx + 1) / 2 * w);
        sy = (float)((1 - ny) / 2 * h);
        return true;
    }

    public Bitmap Render(int w, int h, out int count)
    {
        Bitmap b = new Bitmap(w, h, PixelFormat.Format32bppPArgb);
        count = 0;
        using (Graphics g = Graphics.FromImage(b))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            lock (bridge.Lock)
            {
                if (bridge.View == null || (DateTime.UtcNow - bridge.ViewAt).TotalSeconds > 1) return b;
                foreach (Remote r in bridge.Remotes.Values)
                {
                    float x, y;
                    if (!Project(bridge.View, r.X, r.Y, r.Z, w, h, out x, out y)) continue;
                    count++;
                    string text = r.Name;
                    if (bridge.HasSelf)
                    {
                        double d = Math.Sqrt(Math.Pow(r.X - bridge.SelfX, 2) + Math.Pow(r.Y - bridge.SelfY, 2) + Math.Pow(r.Z - bridge.SelfZ, 2));
                        text += "  " + (d < 1000 ? Math.Round(d) + " m" : (d / 1000).ToString("0.0") + " km");
                    }
                    SizeF size = g.MeasureString(text, font);
                    RectangleF box = new RectangleF(x - size.Width / 2 - 8, y - size.Height - 18, size.Width + 16, size.Height + 4);
                    using (SolidBrush back = new SolidBrush(Color.FromArgb(175, 16, 20, 18))) g.FillRectangle(back, box);
                    g.DrawString(text, font, Brushes.White, box.X + 8, box.Y + 2);
                    using (SolidBrush dot = new SolidBrush(Color.FromArgb(246, 184, 60))) g.FillPolygon(dot, new PointF[] { new PointF(x - 6, y - 12), new PointF(x + 6, y - 12), new PointF(x, y - 4) });
                }
            }
        }
        return b;
    }

    void Draw()
    {
        bool live;
        lock (bridge.Lock) live = bridge.View != null && (DateTime.UtcNow - bridge.ViewAt).TotalSeconds < 1 && bridge.Remotes.Count > 0;
        Native.RECT r = new Native.RECT();
        if (target == IntPtr.Zero || !live || !Native.GetClientRect(target, out r) || r.R < 64 || r.B < 64 || r.R > 8192 || r.B > 8192) { if (Visible) Hide(); return; }
        Native.POINT at = new Native.POINT();
        Native.ClientToScreen(target, ref at);
        if (!Visible) Show();
        int n;
        using (Bitmap b = Render(r.R, r.B, out n)) Native.Layer(Handle, b, at.X, at.Y);
    }
}

sealed class ChatBox : Form
{
    readonly TextBox box = new TextBox();
    readonly Bridge bridge;
    IntPtr game;
    DateTime opened;

    public ChatBox(Bridge b)
    {
        bridge = b;
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        ShowInTaskbar = false;
        TopMost = true;
        BackColor = Color.FromArgb(79, 182, 140);
        Padding = new Padding(2);
        box.Dock = DockStyle.Fill;
        box.BorderStyle = BorderStyle.None;
        box.Font = new Font("Segoe UI", 13f);
        box.BackColor = Color.FromArgb(24, 28, 26);
        box.ForeColor = Color.White;
        box.MaxLength = 200;
        box.KeyDown += delegate(object s, KeyEventArgs e)
        {
            if (e.KeyCode != Keys.Enter && e.KeyCode != Keys.Escape) return;
            e.SuppressKeyPress = true;
            string text = box.Text.Trim();
            if (e.KeyCode == Keys.Enter && text.Length > 0) bridge.SendChat(text);
            Hide();
            Native.SetForegroundWindow(game);
        };
        Controls.Add(box);
        // Windows peut désactiver la fenêtre une première fois en lui donnant le focus.
        Deactivate += delegate { if ((DateTime.UtcNow - opened).TotalMilliseconds > 300) Hide(); };
    }

    public void Open(Point at, IntPtr window)
    {
        game = window;
        box.Text = "";
        opened = DateTime.UtcNow;
        Bounds = new Rectangle(at.X, at.Y, 360, 30);
        Show();
        Native.ForceForeground(Handle, window);
        Activate();
        box.Focus();
    }
}

static class Native
{
    public struct POINT { public int X, Y; }
    public struct SIZE { public int W, H; }
    public struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    public struct BLEND { public byte Op, Flags, Alpha, Format; }
    delegate bool EnumProc(IntPtr h, IntPtr l);

    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool IsHungAppWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr h, int id, uint mod, uint key);
    [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h, int id);
    [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
    [DllImport("user32.dll")] public static extern bool UpdateLayeredWindow(IntPtr h, IntPtr screen, ref POINT at, ref SIZE size, IntPtr src, ref POINT from, int key, ref BLEND blend, int flags);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr dc, IntPtr o);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr o);
    [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr dc);

    /// Pose une image à transparence par pixel dans une fenêtre superposée.
    public static void Layer(IntPtr window, Bitmap b, int x, int y)
    {
        IntPtr screen = GetDC(IntPtr.Zero), mem = CreateCompatibleDC(screen), bits = b.GetHbitmap(Color.FromArgb(0)), old = SelectObject(mem, bits);
        POINT at = new POINT(); at.X = x; at.Y = y;
        POINT zero = new POINT();
        SIZE size = new SIZE(); size.W = b.Width; size.H = b.Height;
        BLEND blend = new BLEND(); blend.Alpha = 255; blend.Format = 1;
        UpdateLayeredWindow(window, screen, ref at, ref size, mem, ref zero, 0, ref blend, 2);
        SelectObject(mem, old);
        DeleteObject(bits);
        DeleteDC(mem);
        ReleaseDC(IntPtr.Zero, screen);
    }

    /// Donne le focus à notre fenêtre depuis celle du jeu, que Windows protège du vol de focus.
    public static void ForceForeground(IntPtr ours, IntPtr from)
    {
        int pid;
        uint other = GetWindowThreadProcessId(from, out pid), mine = GetCurrentThreadId();
        // Un jeu figé figerait aussi la surcouche.
        bool joined = other != mine && !IsHungAppWindow(from) && AttachThreadInput(mine, other, true);
        BringWindowToTop(ours);
        SetForegroundWindow(ours);
        if (joined) AttachThreadInput(mine, other, false);
    }

    public static bool IsOurs(IntPtr h)
    {
        int pid;
        GetWindowThreadProcessId(h, out pid);
        return pid == System.Diagnostics.Process.GetCurrentProcess().Id;
    }

    /// Plus grande fenêtre visible du processus.
    public static IntPtr MainWindow(int pid)
    {
        IntPtr best = IntPtr.Zero;
        long area = 0;
        EnumWindows(delegate(IntPtr h, IntPtr l)
        {
            int owner;
            RECT r;
            GetWindowThreadProcessId(h, out owner);
            if (owner != pid || !IsWindowVisible(h)) return true;
            if (best == IntPtr.Zero && IsIconic(h)) { best = h; return true; }
            if (GetClientRect(h, out r) && (long)r.R * r.B > area) { area = (long)r.R * r.B; best = h; }
            return true;
        }, IntPtr.Zero);
        return best;
    }
}
