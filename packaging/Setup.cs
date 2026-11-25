// Installateur de SixM : pour l'utilisateur courant, sans droits d'administrateur.
// Options : --silent, --dir <dossier>, --no-shortcuts, --no-launch, --uninstall.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Program
{
    const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\SixM";
    const string Marker = "sixm-install.txt"; // prouve qu'un dossier vient de cet installateur
    public static string Version = Assembly.GetExecutingAssembly().GetName().Version.ToString(3);
    static string dir;
    static bool silent, shortcuts = true, launch = true, uninstall, customDir;

    [STAThread]
    static int Main(string[] args)
    {
        dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "SixM");
        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--silent": silent = true; break;
                case "--no-shortcuts": shortcuts = false; break;
                case "--no-launch": launch = false; break;
                case "--uninstall": uninstall = true; break;
                case "--dir":
                    if (++i >= args.Length || !Path.IsPathRooted(args[i])) return 2;
                    dir = Path.GetFullPath(args[i]).TrimEnd('\\');
                    customDir = true;
                    break;
                default: return 2;
            }
        }
        Application.EnableVisualStyles();
        if (uninstall) return Run(Uninstall, "Désinstaller SixM", "Désinstaller", "SixM sera retiré. Vos réglages, serveurs et VIctory restent dans votre dossier SixM.", "SixM est désinstallé.");
        return Run(Install, "Installer SixM " + Version, "Installer", "SixM s'installe pour votre compte Windows, sans droits d'administrateur.", "SixM est installé.");
    }

    static int Run(Action work, string title, string button, string text, string done)
    {
        if (silent)
        {
            try { work(); return 0; }
            catch (Exception e) { Console.Error.WriteLine(e.Message); return 1; }
        }
        using (SetupForm f = new SetupForm(work, title, button, text, done)) Application.Run(f);
        return SetupForm.Failed ? 1 : 0;
    }

    static void Install()
    {
        // Ne jamais écraser un dossier qui ne vient pas de nous.
        if (Directory.Exists(dir) && Directory.GetFileSystemEntries(dir).Length > 0 && !File.Exists(Path.Combine(dir, Marker)))
            throw new InvalidOperationException("Le dossier " + dir + " existe déjà et n'est pas une installation de SixM.");
        string parent = Path.GetDirectoryName(dir);
        Directory.CreateDirectory(parent);
        string fresh = Path.Combine(parent, "SixM.new-" + Process.GetCurrentProcess().Id), old = Path.Combine(parent, "SixM.old-" + Process.GetCurrentProcess().Id);
        try
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
            using (ZipArchive zip = new ZipArchive(s, ZipArchiveMode.Read)) zip.ExtractToDirectory(fresh);
            File.Copy(Application.ExecutablePath, Path.Combine(fresh, "Uninstall.exe"));
            File.WriteAllText(Path.Combine(fresh, Marker), Version);

            // Bascule : l'ancienne version revient si la nouvelle ne peut pas prendre sa place.
            StopRunning();
            bool had = Directory.Exists(dir);
            if (had) Retry(delegate { Directory.Move(dir, old); });
            try { Retry(delegate { Directory.Move(fresh, dir); }); }
            catch { if (had) Directory.Move(old, dir); throw; }
        }
        catch (UnauthorizedAccessException) { throw new IOException("SixM est peut-être ouvert. Fermez-le puis recommencez."); }
        finally { TryDelete(fresh); TryDelete(old); }

        if (!customDir)
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                string un = Path.Combine(dir, "Uninstall.exe");
                k.SetValue("DisplayName", "SixM");
                k.SetValue("DisplayVersion", Version);
                k.SetValue("Publisher", "SyanCode");
                k.SetValue("InstallLocation", dir);
                k.SetValue("DisplayIcon", Path.Combine(dir, "SixM.exe"));
                k.SetValue("UninstallString", "\"" + un + "\" --uninstall");
                k.SetValue("QuietUninstallString", "\"" + un + "\" --uninstall --silent");
                k.SetValue("URLInfoAbout", "https://github.com/SyanCode/SixM");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        if (shortcuts) foreach (string f in Shortcuts()) Shortcut(f);
        if (launch) Process.Start(Path.Combine(dir, "SixM.exe"));
    }

    static void Uninstall()
    {
        // Lancé depuis le dossier à supprimer : on continue depuis une copie temporaire.
        string self = Application.ExecutablePath;
        if (!customDir) dir = Path.GetDirectoryName(self);
        if (string.Equals(Path.GetDirectoryName(self), dir, StringComparison.OrdinalIgnoreCase))
        {
            string copy = Path.Combine(Path.GetTempPath(), "SixM-Uninstall-" + Guid.NewGuid().ToString("N") + ".exe");
            File.Copy(self, copy);
            bool standard = string.Equals(dir, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "SixM"), StringComparison.OrdinalIgnoreCase);
            ProcessStartInfo p = new ProcessStartInfo(copy, "--uninstall --silent --dir \"" + dir + "\"");
            p.UseShellExecute = false;
            p.EnvironmentVariables["SIXM_UNINSTALL_KEY"] = standard ? "1" : "0";
            p.WorkingDirectory = Path.GetTempPath();
            using (Process child = Process.Start(p))
            {
                // Ce processus verrouille son propre exe : la copie attend qu'il se termine pour le supprimer.
                if (!silent) return;
            }
            return;
        }
        if (!File.Exists(Path.Combine(dir, Marker))) throw new InvalidOperationException(dir + " n'est pas une installation de SixM.");
        StopRunning();
        Retry(delegate { if (Directory.Exists(dir)) Directory.Delete(dir, true); });
        if (Environment.GetEnvironmentVariable("SIXM_UNINSTALL_KEY") == "1")
        {
            Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false);
            foreach (string f in Shortcuts()) if (File.Exists(f)) File.Delete(f);
        }
    }

    static IEnumerable<string> Shortcuts()
    {
        yield return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "SixM.lnk");
        yield return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "SixM.lnk");
    }

    static void Shortcut(string file)
    {
        Type t = Type.GetTypeFromProgID("WScript.Shell");
        object shell = Activator.CreateInstance(t);
        object link = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { file });
        Type l = link.GetType();
        l.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { Path.Combine(dir, "SixM.exe") });
        l.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { dir });
        l.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { "SixM" });
        l.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
    }

    /// Arrête uniquement les programmes lancés depuis notre dossier.
    static void StopRunning()
    {
        string prefix = dir + "\\";
        foreach (string name in new[] { "node", "SixM" })
            foreach (Process p in Process.GetProcessesByName(name))
                using (p)
                {
                    try
                    {
                        if (p.Id != Process.GetCurrentProcess().Id && p.MainModule.FileName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) { p.Kill(); p.WaitForExit(5000); }
                    }
                    catch (System.ComponentModel.Win32Exception) { }
                    catch (InvalidOperationException) { }
                }
    }

    static void Retry(Action a)
    {
        for (int i = 0; ; i++)
        {
            try { a(); return; }
            catch (Exception e) { if (i >= 24 || !(e is IOException || e is UnauthorizedAccessException)) throw; Thread.Sleep(250); }
        }
    }

    static void TryDelete(string d)
    {
        try { if (Directory.Exists(d)) Directory.Delete(d, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}

sealed class SetupForm : Form
{
    public static bool Failed;

    public SetupForm(Action work, string title, string button, string text, string done)
    {
        Text = title;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        ClientSize = new Size(440, 190);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(13, 16, 21);
        ForeColor = Color.FromArgb(238, 241, 244);
        Font = new Font("Segoe UI", 10f);
        Label head = new Label(), body = new Label();
        head.Text = title;
        head.Font = new Font("Segoe UI Semibold", 17f);
        head.SetBounds(24, 20, 392, 38);
        body.Text = text;
        body.SetBounds(24, 62, 392, 60);
        ProgressBar bar = new ProgressBar();
        bar.Style = ProgressBarStyle.Marquee;
        bar.SetBounds(24, 140, 230, 10);
        bar.Visible = false;
        Button go = new Button();
        go.Text = button;
        go.FlatStyle = FlatStyle.Flat;
        go.FlatAppearance.BorderSize = 0;
        go.BackColor = Color.FromArgb(246, 184, 60);
        go.ForeColor = Color.FromArgb(27, 19, 0);
        go.SetBounds(276, 130, 140, 38);
        bool finished = false;
        go.Click += delegate
        {
            if (finished) { Close(); return; }
            go.Enabled = false;
            bar.Visible = true;
            Thread t = new Thread(delegate()
            {
                string result = done;
                Failed = false;
                try { work(); } catch (Exception e) { result = e.Message; Failed = true; }
                BeginInvoke((Action)delegate
                {
                    bar.Visible = false;
                    body.Text = result;
                    go.Enabled = true;
                    if (!Failed) { go.Text = "Fermer"; finished = true; }
                });
            });
            t.SetApartmentState(ApartmentState.STA);
            t.IsBackground = true;
            t.Start();
        };
        Controls.AddRange(new Control[] { head, body, bar, go });
        AcceptButton = go;
    }
}
