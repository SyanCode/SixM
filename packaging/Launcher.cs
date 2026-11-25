// SixM.exe : lance SixM avec le Node.js fourni, sans fenêtre noire.
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string node = Path.Combine(root, "node", "node.exe"), script = Path.Combine(root, "app", "bin", "sixm.js");
        if (!File.Exists(node) || !File.Exists(script))
        {
            MessageBox.Show("L'installation de SixM est incomplète. Réinstallez-la.", "SixM", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        ProcessStartInfo p = new ProcessStartInfo(node, "\"" + script + "\" app");
        p.UseShellExecute = false;
        p.CreateNoWindow = true;
        p.WorkingDirectory = root;
        p.EnvironmentVariables["SIXM_BACKGROUND"] = "1"; // s'arrête seul quand plus rien ne tourne
        p.EnvironmentVariables.Remove("NODE_OPTIONS");
        try { Process.Start(p); return 0; }
        catch (Exception e)
        {
            MessageBox.Show("SixM ne démarre pas : " + e.Message, "SixM", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
