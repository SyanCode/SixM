// SixM Link : relie SixM à VIctory sans modifier ni l'un ni l'autre.
//
// Côté SixM, il joue le rôle du bridge (integrations/victory/PROTOCOL.md) sur 127.0.0.1.
// Côté jeu, il dessine une surcouche (chat, joueurs, radar, menus des mods) au-dessus de la fenêtre de VIctory.
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
        // Rendu seul, sans fenêtre ni appel à Windows : marche aussi sous Mono.
        if (args.Length == 3 && args[0] == "--render-menu") return RenderMenu(args[1], args[2]);
        Native.SetProcessDPIAware();
        Application.EnableVisualStyles();
        // Programme sans console : Console.OutputEncoding échouerait, on ouvre les flux nous-mêmes.
        Out = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        Out.AutoFlush = true;
        if (args.Length == 2 && args[0] == "--pick") return Pick(args[1]);
        if (args.Length == 2 && args[0] == "--pick-folder") return PickFolder(args[1]);
        int port;
        bool demo = args.Length == 3 && args[2] == "--demo";
        if ((args.Length != 2 && !demo) || args[0] != "--serve" || !int.TryParse(args[1], out port)) return 2;

        Bridge bridge = new Bridge();
        // Démo : une fausse fenêtre de jeu, pour voir la surcouche sans lancer le jeu.
        if (demo)
        {
            DemoWindow window = new DemoWindow();
            window.Show();
            bridge.DefaultTarget = System.Diagnostics.Process.GetCurrentProcess().Id;
            bridge.TargetPid = bridge.DefaultTarget;
        }
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

    /// Dessine un menu décrit en JSON ({"menu": {...}}) dans un PNG : tests et captures, sans jeu.
    static int RenderMenu(string jsonFile, string png)
    {
        Dictionary<string, object> m = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(jsonFile, Encoding.UTF8));
        object raw;
        MenuData menu = MenuData.Parse(m.TryGetValue("menu", out raw) ? raw : null, 0);
        if (menu == null) return 3;
        List<MenuData> stack = new List<MenuData>();
        stack.Add(menu);
        object open;
        if (m.TryGetValue("depth", out open) && open is int)
            for (int i = 1; i < (int)open; i++)
            {
                MenuItemData sub = stack[stack.Count - 1].Items.Find(x => x.Sub != null);
                if (sub == null) break;
                stack.Add(sub.Sub);
            }
        // select : ligne choisie de la page affichée.
        object sel;
        MenuData last = stack[stack.Count - 1];
        if (m.TryGetValue("select", out sel) && sel is int) last.Sel = Math.Max(0, Math.Min(last.Items.Count - 1, (int)sel));
        object armed;
        using (Bitmap b = MenuPainter.Render(stack, m.TryGetValue("armed", out armed) ? armed as string : null)) b.Save(png, ImageFormat.Png);
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
sealed class Notice { public string Title, Text; public Color Color; public double Seconds; public DateTime At; }
sealed class Line { public string Text; public DateTime At; }

/// Serveur NDJSON local, un seul client à la fois.
sealed class Bridge
{
    const int MaxLine = 1 << 20;
    public readonly object Lock = new object();
    public readonly Dictionary<int, Remote> Remotes = new Dictionary<int, Remote>();
    public readonly List<string> Players = new List<string>();
    public readonly List<Line> Lines = new List<Line>();
    public readonly List<MenuData> Menu = new List<MenuData>(); // pile des sous-menus, vide : fermé
    public readonly List<Notice> Notices = new List<Notice>();
    public string ArmedId; // ligne qui attend une seconde validation
    public DateTime ArmedAt;
    public bool HasWorld, WorldFrozen;
    public int WorldMinutes;
    public string Weather = "clear";
    public DateTime WorldAt;
    /// Saisie demandée par une ligne « input » : menu, ligne, longueur maximale, invite, texte actuel.
    public Action<string, string, int, string, string> AskText;
    public string Server = "";
    public int TargetPid, DefaultTarget;
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
        Remotes.Clear(); Players.Clear(); Lines.Clear(); Menu.Clear(); Notices.Clear(); HasWorld = false; ArmedId = null;
        Server = ""; TargetPid = DefaultTarget; View = null; HasSelf = false; Version++;
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
            case "target": TargetPid = DefaultTarget != 0 ? DefaultTarget : (int)Num(m, "pid"); return true;
            case "menu":
                {
                    object raw;
                    MenuData d = MenuData.Parse(m.TryGetValue("menu", out raw) ? raw : null, 0);
                    if (d == null) return false;
                    Rebuild(d);
                    return true;
                }
            case "menuClose": Menu.Clear(); ArmedId = null; return true;
            case "notify":
                {
                    Notice n = new Notice();
                    n.Title = Str(m, "title", 48);
                    n.Text = Str(m, "text", 200);
                    n.Color = MenuData.ParseColor(Str(m, "color", 7), Color.FromArgb(247, 130, 30));
                    n.Seconds = Math.Max(2, Math.Min(15, Num(m, "seconds") > 0 ? Num(m, "seconds") : 5));
                    n.At = DateTime.UtcNow;
                    if (n.Title.Length == 0 && n.Text.Length == 0) return false;
                    Notices.Add(n);
                    if (Notices.Count > 5) Notices.RemoveAt(0);
                    return true;
                }
            case "world":
                {
                    string w = Str(m, "weather", 16);
                    if (Array.IndexOf(new[] { "clear", "clouds", "rain", "thunder", "fog", "snow" }, w) < 0) w = "clear";
                    WorldMinutes = ((int)Num(m, "minutes") % 1440 + 1440) % 1440;
                    Weather = w;
                    object f;
                    WorldFrozen = m.TryGetValue("frozen", out f) && f is bool && (bool)f;
                    WorldAt = DateTime.UtcNow;
                    HasWorld = true;
                    return true;
                }
            default: return false;
        }
    }

    /// Menu renvoyé par SixM : même page et même ligne si elles existent encore, sinon le chemin demandé.
    void Rebuild(MenuData d)
    {
        List<MenuData> old = new List<MenuData>(Menu);
        Menu.Clear();
        Menu.Add(d);
        ArmedId = null;
        if (old.Count > 0 && old[0].Id == d.Id)
        {
            for (int i = 0; i < old.Count; i++)
            {
                MenuData cur = Menu[Menu.Count - 1], was = old[i];
                string sel = was.Sel < was.Items.Count ? was.Items[was.Sel].Id : null;
                int at = cur.Items.FindIndex(x => x.Kind != "separator" && x.Id == sel);
                cur.Sel = at >= 0 ? at : Math.Min(was.Sel, Math.Max(0, cur.Items.Count - 1));
                cur.Top = was.Top;
                if (i + 1 >= old.Count) break;
                MenuItemData next = cur.Items.Find(x => x.Kind == "submenu" && x.Sub != null && x.Id == old[i + 1].Via);
                if (next == null) break;
                Menu.Add(next.Sub);
            }
        }
        if (Menu.Count == 1)
            foreach (string id in d.Open)
            {
                MenuData cur = Menu[Menu.Count - 1];
                int at = cur.Items.FindIndex(x => x.Kind == "submenu" && x.Sub != null && x.Id == id);
                if (at < 0) break;
                cur.Sel = at;
                Menu.Add(cur.Items[at].Sub);
            }
    }

    public void SendMenuSelect(string menu, string item, object value)
    {
        Dictionary<string, object> m = new Dictionary<string, object>();
        m["t"] = "menuSelect"; m["menu"] = menu; m["item"] = item; m["value"] = value;
        Send(m);
    }

    public const int KeyToggle = 0, KeyUp = 1, KeyDown = 2, KeyLeft = 3, KeyRight = 4, KeyEnter = 5, KeyBack = 6;

    /// Touche du menu, prise au jeu : navigation locale, choix envoyés à SixM.
    public void MenuKey(int k)
    {
        Dictionary<string, object> send = null;
        object[] ask = null;
        lock (Lock)
        {
            if (k == KeyToggle)
            {
                if (Menu.Count == 0) { send = new Dictionary<string, object>(); send["t"] = "menuOpen"; }
                else { Menu.Clear(); send = new Dictionary<string, object>(); send["t"] = "menuClose"; }
            }
            else if (Menu.Count > 0)
            {
                MenuData d = Menu[Menu.Count - 1];
                if (k != KeyEnter) ArmedId = null;
                if (k == KeyBack)
                {
                    Menu.RemoveAt(Menu.Count - 1);
                    if (Menu.Count == 0) { send = new Dictionary<string, object>(); send["t"] = "menuClose"; }
                }
                else if (k == KeyUp || k == KeyDown) { d.Move(k == KeyDown); ArmedId = null; }
                else if (d.Items.Count > 0)
                {
                    MenuItemData it = d.Items[d.Sel];
                    bool fire = false;
                    object value = null;
                    if (it.Disabled || it.Kind == "separator") { }
                    else if (it.Kind == "checkbox") { it.Check = !it.Check; value = it.Check; fire = true; }
                    else if (it.Kind == "list" && it.Options.Count > 0)
                    {
                        if (k != KeyEnter) it.Index = (it.Index + (k == KeyRight ? 1 : it.Options.Count - 1)) % it.Options.Count;
                        value = it.Index;
                        fire = true;
                    }
                    else if (it.Kind == "slider" && k != KeyEnter)
                    {
                        double v = it.Value + (k == KeyRight ? it.Step : -it.Step);
                        it.Value = Math.Max(it.Min, Math.Min(it.Max, Math.Round(v / it.Step) * it.Step));
                        value = it.Value;
                        fire = true;
                    }
                    else if (it.Kind == "submenu" && k == KeyEnter && it.Sub != null) Menu.Add(it.Sub);
                    else if (it.Kind == "button" && k == KeyEnter)
                    {
                        // Action sensible : deux validations en moins de 4 secondes.
                        if (!it.Confirm || (ArmedId == it.Id && (DateTime.UtcNow - ArmedAt).TotalSeconds < 4)) { fire = true; ArmedId = null; }
                        else { ArmedId = it.Id; ArmedAt = DateTime.UtcNow; }
                    }
                    else if (it.Kind == "input" && k == KeyEnter)
                    {
                        ask = new object[] { d.Id, it.Id, it.MaxLength, it.Placeholder.Length > 0 ? it.Placeholder : it.Label, it.Text };
                    }
                    if (fire)
                    {
                        send = new Dictionary<string, object>();
                        send["t"] = "menuSelect"; send["menu"] = d.Id; send["item"] = it.Id; send["value"] = value;
                    }
                }
            }
            Version++;
        }
        if (send != null) Send(send);
        if (ask != null && AskText != null) AskText((string)ask[0], (string)ask[1], (int)ask[2], (string)ask[3], (string)ask[4]);
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

    public static string Str(Dictionary<string, object> m, string k, int max)
    {
        object v;
        return m.TryGetValue(k, out v) && v is string ? Clean((string)v, max) : "";
    }

    public static double Num(Dictionary<string, object> m, string k)
    {
        object v;
        if (!m.TryGetValue(k, out v) || !(v is int || v is decimal || v is double || v is long)) return 0;
        double d = Convert.ToDouble(v);
        return d > -2e9 && d < 2e9 ? d : 0;
    }

    public static string Clean(string s, int max)
    {
        StringBuilder sb = new StringBuilder();
        foreach (char c in s) { if (sb.Length == max) break; sb.Append(char.IsControl(c) ? ' ' : c); }
        return sb.ToString();
    }
}

/// Panneau transparent aux clics, posé sur la fenêtre du jeu. F8 : écrire, F9 : masquer.
sealed class Overlay : Form
{
    const int ChatKey = 1, HideKey = 2, MenuKey = 3, NavKey = 10, PanelWidth = 360, PanelHeight = 460;
    // Touches du menu ouvert : haut, bas, gauche, droite, Entrée, Retour arrière, Échap.
    static readonly int[] NavVk = { 0x26, 0x28, 0x25, 0x27, 0x0D, 0x08, 0x1B };
    static readonly int[] NavAction = { Bridge.KeyUp, Bridge.KeyDown, Bridge.KeyLeft, Bridge.KeyRight, Bridge.KeyEnter, Bridge.KeyBack, Bridge.KeyBack };
    readonly Bridge bridge;
    readonly ChatBox chat;
    readonly Markers markers;
    readonly MenuLayer menu = new MenuLayer(), notices = new MenuLayer();
    bool nav;
    int menuVersion = -1;
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
        // Ligne « input » d'un menu : la boîte de saisie s'ouvre sous le menu, le texte part au serveur.
        b.AskText = delegate(string menuId, string item, int max, string title, string text)
        {
            chat.Ask(new Point(place.X + PanelWidth + 12, place.Y + 4), target, title, max, text, delegate(string value) { bridge.SendMenuSelect(menuId, item, value); });
            Follow();
        };
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
            int id = (int)m.WParam;
            if (id == ChatKey) chat.Open(new Point(place.X, place.Y + PanelHeight), target);
            else if (id == MenuKey) { bridge.MenuKey(Bridge.KeyToggle); Follow(); }
            else if (id >= NavKey && id < NavKey + NavVk.Length) { bridge.MenuKey(NavAction[id - NavKey]); Follow(); }
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
            if (inGame) { Native.RegisterHotKey(Handle, ChatKey, 0x4000, 0x77); Native.RegisterHotKey(Handle, HideKey, 0x4000, 0x78); Native.RegisterHotKey(Handle, MenuKey, 0x4000, 0x76); }
            else { Native.UnregisterHotKey(Handle, ChatKey); Native.UnregisterHotKey(Handle, HideKey); Native.UnregisterHotKey(Handle, MenuKey); }
        }
        // Flèches, Entrée et Retour ne sont prises au jeu que menu ouvert.
        bool open;
        lock (bridge.Lock) open = bridge.Menu.Count > 0;
        // Pendant une saisie, Entrée et Retour arrière vont à la boîte de texte.
        bool wantNav = inGame && !hidden && open && !chat.Visible;
        if (wantNav != nav)
        {
            nav = wantNav;
            for (int i = 0; i < NavVk.Length; i++)
            {
                if (nav) Native.RegisterHotKey(Handle, NavKey + i, 0, (uint)NavVk[i]);
                else Native.UnregisterHotKey(Handle, NavKey + i);
            }
        }
        if (!inGame || hidden)
        {
            if (Visible) Hide();
            if (menu.Visible) menu.Hide();
            if (notices.Visible) notices.Hide();
            if (!inGame && chat.Visible) chat.Hide();
            drawn = false;
            menuVersion = -1;
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
        bool clock;
        lock (bridge.Lock) clock = bridge.HasWorld && !bridge.WorldFrozen;
        if (moved || v != version || !drawn || fading || clock) { version = v; drawn = true; Present(); }
        // Notifications des mods, en haut à droite du jeu.
        Bitmap nb;
        lock (bridge.Lock)
        {
            bridge.Notices.RemoveAll(n => (DateTime.UtcNow - n.At).TotalSeconds > n.Seconds);
            nb = bridge.Notices.Count > 0 ? NoticePainter.Render(bridge.Notices) : null;
        }
        if (nb == null) { if (notices.Visible) notices.Hide(); }
        else using (nb)
        {
            Native.RECT client;
            Native.GetClientRect(target, out client);
            if (!notices.Visible) notices.Show();
            Native.Layer(notices.Handle, nb, at.X + Math.Max(0, client.R - nb.Width - 16), at.Y + 16);
        }
        // Menu à droite du panneau, en haut de l'écran.
        if (!open) { if (menu.Visible) menu.Hide(); menuVersion = -1; }
        else if (moved || v != menuVersion)
        {
            menuVersion = v;
            Bitmap b;
            lock (bridge.Lock) b = MenuPainter.Render(bridge.Menu, Armed());
            using (b)
            {
                if (!menu.Visible) menu.Show();
                Native.Layer(menu.Handle, b, place.X + PanelWidth + 12, place.Y);
            }
        }
    }

    /// Ligne qui attend sa confirmation (4 s au plus).
    string Armed()
    {
        return bridge.ArmedId != null && (DateTime.UtcNow - bridge.ArmedAt).TotalSeconds < 4 ? bridge.ArmedId : null;
    }

    public void Dump(string file)
    {
        using (Bitmap b = Render()) b.Save(file, ImageFormat.Png);
        int shown;
        using (Bitmap m = markers.Render(1280, 720, out shown)) m.Save(file + ".markers.png", ImageFormat.Png);
        bool open;
        lock (bridge.Lock)
        {
            open = bridge.Menu.Count > 0;
            if (open) using (Bitmap mb = MenuPainter.Render(bridge.Menu, Armed())) mb.Save(file + ".menu.png", ImageFormat.Png);
        }
        Program.Out.WriteLine("dumped visible=" + (Visible ? 1 : 0) + " target=" + (target != IntPtr.Zero ? 1 : 0) + " markers=" + shown + " menu=" + (open ? 1 : 0));
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
                int head = bridge.HasWorld ? 20 : 0;
                Panel(g, 0, 0, 220, 34 + head + Math.Min(bridge.Players.Count, 8) * 20);
                Label(g, title, bold, Color.White, 12, 6, 196);
                if (bridge.HasWorld)
                {
                    // Le serveur avance d'une minute toutes les 2 s.
                    int min = bridge.WorldFrozen ? bridge.WorldMinutes : (bridge.WorldMinutes + (int)((DateTime.UtcNow - bridge.WorldAt).TotalSeconds / 2)) % 1440;
                    string w = new Dictionary<string, string> { { "clear", "Ensoleillé" }, { "clouds", "Nuageux" }, { "rain", "Pluie" }, { "thunder", "Orage" }, { "fog", "Brouillard" }, { "snow", "Neige" } }[bridge.Weather];
                    Label(g, (min / 60).ToString("00") + ":" + (min % 60).ToString("00") + "  ·  " + w + (bridge.WorldFrozen ? "  ·  figée" : ""), small, Color.FromArgb(246, 184, 60), 12, 26, 196);
                }
                for (int i = 0; i < bridge.Players.Count && i < 8; i++)
                {
                    string name = i == 7 && bridge.Players.Count > 8 ? "… et " + (bridge.Players.Count - 7) + " autres" : bridge.Players[i];
                    Label(g, name, font, Color.FromArgb(230, 235, 232), 12, 28 + head + i * 20, 196);
                }
                if (bridge.Remotes.Count > 0) Radar(g, 230, 0, 120);
                float y = PanelHeight - 20;
                Panel(g, 0, (int)y - 2, 205, 20);
                Label(g, "F7 menu   F8 écrire   F9 masquer", small, Color.White, 8, y, 300);
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

/// Ligne d'un menu de mod (forme : docs/MENUS.md).
sealed class MenuItemData
{
    public string Id = "", Kind = "button", Label = "", Desc = "", Right = "", Badge = "", Text = "", Placeholder = "";
    public bool Disabled, Check, Confirm;
    public Color BadgeColor = Color.Empty;
    public int MaxLength = 100;
    public int Index;
    public double Value, Min, Max = 100, Step = 1;
    public readonly List<string> Options = new List<string>();
    public MenuData Sub;
}

/// Menu reçu de SixM, déjà vérifié par lui ; relu ici avec les mêmes bornes.
sealed class MenuData
{
    public string Id = "", Title = "", Subtitle = "", Via; // Via : ligne de la page précédente qui a ouvert celle-ci
    public Color Color = Color.FromArgb(247, 130, 30);
    public readonly List<MenuItemData> Items = new List<MenuItemData>();
    public readonly List<string> Open = new List<string>(); // sous-menus à ouvrir d'emblée
    public int Sel, Top;

    public static Color ParseColor(string c, Color fallback)
    {
        int rgb;
        if (c.Length == 7 && c[0] == '#' && int.TryParse(c.Substring(1), System.Globalization.NumberStyles.HexNumber, null, out rgb))
            return Color.FromArgb(255, (rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255);
        return fallback;
    }

    public static MenuData Parse(object raw, int depth)
    {
        Dictionary<string, object> m = raw as Dictionary<string, object>;
        object v;
        System.Collections.IList items = m != null && m.TryGetValue("items", out v) ? v as System.Collections.IList : null;
        if (m == null || items == null || depth > 4) return null;
        MenuData d = new MenuData();
        d.Id = Bridge.Str(m, "id", 48);
        if (d.Id.Length == 0) return null;
        d.Title = Bridge.Str(m, "title", 48);
        d.Subtitle = Bridge.Str(m, "subtitle", 64);
        d.Color = ParseColor(Bridge.Str(m, "color", 7), d.Color);
        if (depth == 0 && m.TryGetValue("open", out v) && v is System.Collections.IList)
            foreach (object id in (System.Collections.IList)v)
                if (id is string && d.Open.Count < 4) d.Open.Add(Bridge.Clean((string)id, 48));
        foreach (object o in items)
        {
            Dictionary<string, object> im = o as Dictionary<string, object>;
            if (im == null || d.Items.Count >= 100) continue;
            MenuItemData it = new MenuItemData();
            it.Id = Bridge.Str(im, "id", 48);
            it.Kind = Bridge.Str(im, "type", 16);
            if (Array.IndexOf(new[] { "button", "checkbox", "list", "slider", "input", "separator", "submenu" }, it.Kind) < 0) it.Kind = "button";
            it.Badge = Bridge.Str(im, "badge", 12);
            it.BadgeColor = ParseColor(Bridge.Str(im, "badgeColor", 7), Color.Empty);
            it.Confirm = im.TryGetValue("confirm", out v) && v is bool && (bool)v;
            it.Placeholder = Bridge.Str(im, "placeholder", 64);
            it.MaxLength = Math.Max(1, Math.Min(200, im.ContainsKey("maxLength") ? (int)Bridge.Num(im, "maxLength") : 100));
            if (it.Kind == "input") it.Text = Bridge.Str(im, "value", 200);
            it.Label = Bridge.Str(im, "label", 64);
            it.Desc = Bridge.Str(im, "description", 200);
            it.Right = Bridge.Str(im, "right", 24);
            it.Disabled = im.TryGetValue("disabled", out v) && v is bool && (bool)v;
            it.Check = im.TryGetValue("value", out v) && v is bool && (bool)v;
            if (im.TryGetValue("options", out v) && v is System.Collections.IList)
                foreach (object opt in (System.Collections.IList)v)
                    if (opt is string && it.Options.Count < 50) it.Options.Add(Bridge.Clean((string)opt, 32));
            it.Index = Math.Max(0, Math.Min(Math.Max(0, it.Options.Count - 1), (int)Bridge.Num(im, "value")));
            it.Min = Bridge.Num(im, "min");
            it.Max = Math.Max(it.Min, im.ContainsKey("max") ? Bridge.Num(im, "max") : 100);
            it.Step = im.ContainsKey("step") && Bridge.Num(im, "step") > 0 ? Bridge.Num(im, "step") : 1;
            it.Value = Math.Max(it.Min, Math.Min(it.Max, Bridge.Num(im, "value")));
            if (it.Kind == "submenu")
            {
                it.Sub = Parse(im.TryGetValue("menu", out v) ? v : null, depth + 1);
                if (it.Sub != null) it.Sub.Via = it.Id;
            }
            d.Items.Add(it);
        }
        d.Sel = 0;
        while (d.Sel < d.Items.Count - 1 && d.Items[d.Sel].Kind == "separator") d.Sel++;
        return d;
    }

    /// Ligne suivante ou précédente, en sautant les séparateurs.
    public void Move(bool down)
    {
        int n = Items.Count;
        if (n == 0) return;
        int i = Sel;
        for (int k = 0; k < n; k++)
        {
            i = down ? (i + 1) % n : (i + n - 1) % n;
            if (Items[i].Kind != "separator") break;
        }
        Sel = i;
    }
}

/// Dessin d'un menu : bandeau, fil d'Ariane et compteur, lignes, description, aide.
static class MenuPainter
{
    public const int Width = 420, Banner = 96, Bar = 30, Row = 38, Visible = 9;

    public static Color Mix(Color a, Color b, double t)
    {
        return Color.FromArgb((int)(a.A + (b.A - a.A) * t), (int)(a.R + (b.R - a.R) * t), (int)(a.G + (b.G - a.G) * t), (int)(a.B + (b.B - a.B) * t));
    }

    public static void Text(Graphics g, string s, Font f, Color c, float x, float y, float w, float h, StringAlignment align)
    {
        using (SolidBrush b = new SolidBrush(c))
        using (StringFormat format = new StringFormat(StringFormatFlags.NoWrap))
        {
            format.Alignment = align;
            format.LineAlignment = StringAlignment.Center;
            format.Trimming = StringTrimming.EllipsisCharacter;
            g.DrawString(s, f, b, new RectangleF(x, y, w, h), format);
        }
    }

    static GraphicsPath Rounded(RectangleF r, float radius)
    {
        GraphicsPath p = new GraphicsPath();
        float d = radius * 2;
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    /// stack : pages ouvertes, la dernière est affichée ; armed : ligne qui attend sa confirmation.
    public static Bitmap Render(List<MenuData> stack, string armed)
    {
        MenuData menu = stack[stack.Count - 1];
        if (menu.Sel < menu.Top) menu.Top = menu.Sel;
        if (menu.Sel >= menu.Top + Visible) menu.Top = menu.Sel + 1 - Visible;
        int shown = Math.Max(1, Math.Min(Visible, menu.Items.Count));
        string desc = menu.Items.Count > 0 ? menu.Items[menu.Sel].Desc : "";
        int height = Banner + Bar + 4 + Row * shown + 6 + (desc.Length > 0 ? 50 : 0) + 26;
        Bitmap b = new Bitmap(Width, height, PixelFormat.Format32bppPArgb);
        Color accent = menu.Color;
        using (Graphics g = Graphics.FromImage(b))
        using (Font title = new Font("Segoe UI", menu.Title.Length > 16 ? 18f : 23f, FontStyle.Bold | FontStyle.Italic))
        using (Font sub = new Font("Segoe UI Semibold", 8.5f))
        using (Font row = new Font("Segoe UI", 10.5f))
        using (Font rowBold = new Font("Segoe UI Semibold", 10.5f))
        using (Font small = new Font("Segoe UI", 8.5f))
        using (Font badge = new Font("Segoe UI", 7f, FontStyle.Bold))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            using (GraphicsPath shape = Rounded(new RectangleF(0, 0, Width - 1, height - 1), 12))
            {
                using (SolidBrush back = new SolidBrush(Color.FromArgb(238, 11, 12, 16))) g.FillPath(back, shape);
                g.SetClip(shape);
            }

            // Bandeau : dégradé, bandes obliques, hexagones, liseré.
            Rectangle banner = new Rectangle(0, 0, Width, Banner);
            using (LinearGradientBrush br = new LinearGradientBrush(banner, accent, Mix(accent, Color.Black, 0.7), 20f)) g.FillRectangle(br, banner);
            using (Pen stripe = new Pen(Color.FromArgb(9, 255, 255, 255), 14))
                for (int k = 0; k < 9; k++) g.DrawLine(stripe, 28 + k * 56, Banner, 98 + k * 56, 0);
            PointF[] hex = new PointF[6], hex2 = new PointF[6];
            for (int k = 0; k < 6; k++)
            {
                hex[k] = new PointF((float)(Width - 56 + 38 * Math.Sin(k * Math.PI / 3)), (float)(Banner / 2 + 4 - 38 * Math.Cos(k * Math.PI / 3)));
                hex2[k] = new PointF((float)(Width - 56 + 20 * Math.Sin(k * Math.PI / 3)), (float)(Banner / 2 + 4 - 20 * Math.Cos(k * Math.PI / 3)));
            }
            using (Pen p = new Pen(Color.FromArgb(55, 255, 255, 255), 2)) g.DrawPolygon(p, hex);
            using (SolidBrush f = new SolidBrush(Color.FromArgb(30, 255, 255, 255))) g.FillPolygon(f, hex2);
            using (LinearGradientBrush line = new LinearGradientBrush(new Rectangle(0, Banner - 2, Width, 2), Color.FromArgb(130, 255, 255, 255), Color.FromArgb(0, 255, 255, 255), 0f))
                g.FillRectangle(line, 0, Banner - 2, Width, 2);
            string t = menu.Title.ToUpperInvariant();
            bool deep = stack.Count > 1 && menu.Subtitle.Length > 0;
            float ty = deep ? 14 : Banner / 2 - title.Height / 2;
            using (SolidBrush shadow = new SolidBrush(Color.FromArgb(110, 0, 0, 0))) g.DrawString(t, title, shadow, 22, ty + 3);
            g.DrawString(t, title, Brushes.White, 20, ty);
            if (deep) Text(g, menu.Subtitle, sub, Color.FromArgb(205, 255, 255, 255), 22, Banner - 34, Width - 120, 22, StringAlignment.Near);

            // Fil d'Ariane et compteur.
            using (SolidBrush bar = new SolidBrush(Color.FromArgb(250, 6, 7, 10))) g.FillRectangle(bar, 0, Banner, Width, Bar);
            int count = 0, index = 0;
            for (int i = 0; i < menu.Items.Count; i++) if (menu.Items[i].Kind != "separator") { count++; if (i <= menu.Sel) index = count; }
            string path;
            if (stack.Count == 1) path = (menu.Subtitle.Length > 0 ? menu.Subtitle : "Menu").ToUpperInvariant();
            else
            {
                List<string> parts = new List<string>();
                for (int i = Math.Max(1, stack.Count - 3); i < stack.Count; i++) parts.Add(stack[i].Title.ToUpperInvariant());
                path = (stack.Count > 4 ? "…  ›  " : "") + string.Join("  ›  ", parts.ToArray());
            }
            Text(g, path, sub, Mix(accent, Color.White, 0.3), 16, Banner, Width - 90, Bar, StringAlignment.Near);
            Text(g, index + " / " + count, sub, Color.FromArgb(140, 146, 158), Width - 96, Banner, 80, Bar, StringAlignment.Far);

            // Lignes.
            int top = Banner + Bar + 4;
            for (int n = 0; n < shown && menu.Top + n < menu.Items.Count; n++)
            {
                int i = menu.Top + n;
                MenuItemData it = menu.Items[i];
                int y = top + n * Row;
                if (it.Kind == "separator")
                {
                    using (Pen line = new Pen(Color.FromArgb(50, 255, 255, 255)))
                    {
                        g.DrawLine(line, 18, y + Row / 2, Width / 2 - 70, y + Row / 2);
                        g.DrawLine(line, Width / 2 + 70, y + Row / 2, Width - 18, y + Row / 2);
                    }
                    Text(g, it.Label.ToUpperInvariant(), small, Color.FromArgb(110, 116, 128), Width / 2 - 70, y, 140, Row, StringAlignment.Center);
                    continue;
                }
                bool on = i == menu.Sel;
                bool isArmed = on && armed != null && armed == it.Id;
                if (on)
                {
                    Color c = isArmed ? Color.FromArgb(229, 72, 77) : accent;
                    RectangleF hl = new RectangleF(6, y + 2, Width - 12, Row - 4);
                    using (GraphicsPath p = Rounded(hl, 6))
                    using (LinearGradientBrush br = new LinearGradientBrush(hl, Color.FromArgb(230, c), Color.FromArgb(40, c), 0f)) g.FillPath(br, p);
                    g.FillRectangle(Brushes.White, 6, y + 2, 3, Row - 4);
                }
                Color fg = it.Disabled ? Color.FromArgb(105, 110, 122) : on ? Color.White : Color.FromArgb(225, 228, 234);
                SizeF ls = g.MeasureString(it.Label, on ? rowBold : row);
                float lw = Math.Min(ls.Width, Width - 210);
                Text(g, it.Label, on ? rowBold : row, fg, 20, y, lw + 4, Row, StringAlignment.Near);
                if (it.Badge.Length > 0)
                {
                    SizeF bs = g.MeasureString(it.Badge, badge);
                    RectangleF br2 = new RectangleF(26 + lw, y + Row / 2 - 8, bs.Width + 6, 16);
                    using (GraphicsPath p = Rounded(br2, 8))
                    using (SolidBrush bb = new SolidBrush(on ? Color.FromArgb(70, 255, 255, 255) : (it.BadgeColor.IsEmpty ? accent : it.BadgeColor))) g.FillPath(bb, p);
                    Text(g, it.Badge, badge, Color.White, br2.X, br2.Y - (Row - 16) / 2f, br2.Width, Row, StringAlignment.Center);
                }
                int right = Width - 20;
                if (isArmed) Text(g, "Entrée encore pour confirmer", rowBold, Color.White, right - 220, y, 220, Row, StringAlignment.Far);
                else if (it.Kind == "checkbox")
                {
                    RectangleF sw = new RectangleF(right - 34, y + Row / 2 - 9, 34, 18);
                    using (GraphicsPath p = Rounded(sw, 9))
                    using (SolidBrush fill = new SolidBrush(it.Check ? (on ? Color.White : Color.FromArgb(48, 164, 108)) : Color.FromArgb(45, 255, 255, 255))) g.FillPath(fill, p);
                    using (SolidBrush knob = new SolidBrush(on && it.Check ? accent : Color.White)) g.FillEllipse(knob, it.Check ? sw.Right - 16 : sw.X + 2, sw.Y + 2, 14, 14);
                }
                else if (it.Kind == "list")
                {
                    string value = it.Options.Count > 0 ? it.Options[it.Index] : "";
                    Text(g, on ? "‹   " + value + "   ›" : value, rowBold, fg, right - 180, y, 180, Row, StringAlignment.Far);
                }
                else if (it.Kind == "slider")
                {
                    double frac = it.Max > it.Min ? (it.Value - it.Min) / (it.Max - it.Min) : 0;
                    int tx = right - 156, ty2 = y + Row / 2 - 2;
                    using (SolidBrush track = new SolidBrush(Color.FromArgb(40, 255, 255, 255))) g.FillRectangle(track, tx, ty2, 110, 4);
                    using (SolidBrush fill = new SolidBrush(on ? Color.White : accent)) g.FillRectangle(fill, tx, ty2, (float)(110 * frac), 4);
                    g.FillEllipse(Brushes.White, (float)(tx + 110 * frac - 6), ty2 - 4, 12, 12);
                    string label = it.Step % 1 == 0 ? Math.Round(it.Value).ToString() : it.Value.ToString("0.0");
                    Text(g, label, rowBold, fg, right - 38, y, 38, Row, StringAlignment.Far);
                }
                else if (it.Kind == "input")
                {
                    RectangleF field = new RectangleF(right - 200, y + 7, 206, Row - 14);
                    using (GraphicsPath p = Rounded(field, 5))
                    using (SolidBrush fill = new SolidBrush(Color.FromArgb(on ? 150 : 90, 0, 0, 0))) g.FillPath(fill, p);
                    bool empty = it.Text.Length == 0;
                    Text(g, empty ? (it.Placeholder.Length > 0 ? it.Placeholder : "Entrée pour écrire") : it.Text, small, empty ? Color.FromArgb(130, 255, 255, 255) : Color.White, field.X + 6, y, field.Width - 12, Row, StringAlignment.Near);
                }
                else if (it.Kind == "submenu") Text(g, (it.Right.Length > 0 ? it.Right + "    " : "") + "›", rowBold, on ? Color.White : Color.FromArgb(160, 166, 178), right - 160, y, 160, Row, StringAlignment.Far);
                else if (it.Right.Length > 0) Text(g, it.Right, rowBold, on ? Color.White : Color.FromArgb(160, 166, 178), right - 160, y, 160, Row, StringAlignment.Far);
                else if (it.Confirm && on) Text(g, "⚠", rowBold, Color.White, right - 30, y, 30, Row, StringAlignment.Far);
            }
            // Barre de défilement.
            if (menu.Items.Count > Visible)
            {
                float trackH = Row * shown - 8, h = trackH * Visible / menu.Items.Count;
                float y0 = top + 4 + (trackH - h) * menu.Top / (menu.Items.Count - Visible);
                using (SolidBrush track = new SolidBrush(Color.FromArgb(20, 255, 255, 255))) g.FillRectangle(track, Width - 5, top + 4, 2, trackH);
                using (SolidBrush thumb = new SolidBrush(accent)) g.FillRectangle(thumb, Width - 5, y0, 2, h);
            }

            int bottom = top + Row * shown + 6;
            if (desc.Length > 0)
            {
                using (GraphicsPath p = Rounded(new RectangleF(10, bottom, Width - 20, 44), 6))
                using (SolidBrush back = new SolidBrush(Color.FromArgb(12, 255, 255, 255))) g.FillPath(back, p);
                using (SolidBrush line = new SolidBrush(accent)) g.FillRectangle(line, 10, bottom, 3, 44);
                using (SolidBrush ink = new SolidBrush(Color.FromArgb(225, 228, 234)))
                    g.DrawString(desc, small, ink, new RectangleF(24, bottom + 5, Width - 46, 36));
                bottom += 50;
            }
            Text(g, "↑↓ naviguer    ←→ changer    Entrée valider    Retour    F7 fermer", small, Color.FromArgb(120, 126, 138), 0, bottom - 6, Width, Row, StringAlignment.Center);
        }
        return b;
    }
}

/// Notifications des mods : cartes empilées, barre du temps restant.
static class NoticePainter
{
    public const int Width = 340;

    public static Bitmap Render(List<Notice> list)
    {
        int h = 0;
        foreach (Notice n in list) h += (n.Title.Length > 0 ? 66 : 48) + 6;
        Bitmap b = new Bitmap(Width, Math.Max(1, h), PixelFormat.Format32bppPArgb);
        using (Graphics g = Graphics.FromImage(b))
        using (Font title = new Font("Segoe UI Semibold", 10f))
        using (Font text = new Font("Segoe UI", 9f))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            int y = 0;
            foreach (Notice n in list)
            {
                int ch = n.Title.Length > 0 ? 66 : 48;
                double age = (DateTime.UtcNow - n.At).TotalSeconds;
                int alpha = (int)(255 * Math.Max(0, Math.Min(1, Math.Min(age / 0.2, (n.Seconds - age) / 0.4))));
                using (SolidBrush back = new SolidBrush(Color.FromArgb(alpha * 235 / 255, 17, 18, 23))) g.FillRectangle(back, 0, y, Width, ch);
                using (SolidBrush bar = new SolidBrush(Color.FromArgb(alpha, n.Color))) g.FillRectangle(bar, 0, y, 4, ch);
                float ty = y + 8;
                if (n.Title.Length > 0)
                {
                    MenuPainter.Text(g, n.Title, title, Color.FromArgb(alpha, 255, 255, 255), 16, ty - 8, Width - 26, 24, StringAlignment.Near);
                    ty += 18;
                }
                using (SolidBrush ink = new SolidBrush(Color.FromArgb(alpha, 220, 224, 230))) g.DrawString(n.Text, text, ink, new RectangleF(16, ty, Width - 26, ch - (ty - y) - 4));
                double left = Math.Max(0, 1 - age / n.Seconds);
                using (SolidBrush rest = new SolidBrush(Color.FromArgb(alpha * 170 / 255, n.Color))) g.FillRectangle(rest, 4, y + ch - 2, (float)((Width - 4) * left), 2);
                y += ch + 6;
            }
        }
        return b;
    }
}

/// Calque du menu, transparent aux clics comme le reste de la surcouche.
sealed class MenuLayer : Form
{
    public MenuLayer()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
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
}

/// Fausse fenêtre de jeu (--demo) : la surcouche s'y attache comme à VIctory.
sealed class DemoWindow : Form
{
    public DemoWindow()
    {
        Text = "SixM : démo de la surcouche";
        ClientSize = new Size(1280, 720);
        StartPosition = FormStartPosition.CenterScreen;
        DoubleBuffered = true;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using (LinearGradientBrush sky = new LinearGradientBrush(ClientRectangle, Color.FromArgb(255, 120, 60), Color.FromArgb(40, 20, 70), 90f)) g.FillRectangle(sky, ClientRectangle);
        using (SolidBrush city = new SolidBrush(Color.FromArgb(18, 14, 30)))
            for (int x = 0, k = 0; x < ClientSize.Width; x += 70, k++)
                g.FillRectangle(city, x, ClientSize.Height - 120 - (k * 53 % 170), 62, 400);
        using (Font f = new Font("Segoe UI", 14f))
        using (SolidBrush ink = new SolidBrush(Color.FromArgb(200, 255, 255, 255)))
            g.DrawString("Fenêtre de démonstration : la surcouche de SixM s'affiche par-dessus.\nF7 : menu des mods   F8 : écrire   F9 : masquer", f, ink, 24, ClientSize.Height - 80);
    }

    protected override void OnResize(EventArgs e) { base.OnResize(e); Invalidate(); }
}

sealed class ChatBox : Form
{
    readonly TextBox box = new TextBox();
    readonly Label hint = new Label();
    readonly Bridge bridge;
    IntPtr game;
    DateTime opened;
    Action<string> submit; // chat, ou texte d'une ligne de menu

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
            if (e.KeyCode == Keys.Enter && text.Length > 0 && submit != null) submit(text);
            Hide();
            Native.SetForegroundWindow(game);
        };
        hint.Dock = DockStyle.Top;
        hint.Height = 22;
        hint.Font = new Font("Segoe UI Semibold", 9f);
        hint.ForeColor = Color.White;
        hint.BackColor = Color.FromArgb(24, 28, 26);
        hint.Padding = new Padding(4, 3, 0, 0);
        Controls.Add(box);
        Controls.Add(hint);
        // Windows peut désactiver la fenêtre une première fois en lui donnant le focus.
        Deactivate += delegate { if ((DateTime.UtcNow - opened).TotalMilliseconds > 300) Hide(); };
    }

    public void Open(Point at, IntPtr window)
    {
        Ask(at, window, null, 200, "", delegate(string text) { bridge.SendChat(text); });
    }

    /// Demande un texte : titre au-dessus, ou rien pour le chat.
    public void Ask(Point at, IntPtr window, string title, int max, string text, Action<string> onSubmit)
    {
        game = window;
        submit = onSubmit;
        box.MaxLength = max;
        box.Text = text ?? "";
        box.SelectionStart = box.Text.Length;
        hint.Text = title ?? "";
        hint.Visible = !string.IsNullOrEmpty(title);
        BackColor = hint.Visible ? Color.FromArgb(247, 130, 30) : Color.FromArgb(79, 182, 140);
        opened = DateTime.UtcNow;
        Bounds = new Rectangle(at.X, at.Y, 400, hint.Visible ? 56 : 30);
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
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int index);
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
            // Nos propres calques (surcouche, noms, menu) ne sont jamais « le jeu ».
            if (owner != pid || !IsWindowVisible(h) || (GetWindowLong(h, -20) & 0x80000) != 0) return true;
            if (best == IntPtr.Zero && IsIconic(h)) { best = h; return true; }
            if (GetClientRect(h, out r) && (long)r.R * r.B > area) { area = (long)r.R * r.B; best = h; }
            return true;
        }, IntPtr.Zero);
        return best;
    }
}
