// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Installer/Installer.cs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using Forms = System.Windows.Forms;

internal sealed class Setup
{
    private readonly Window window;
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private readonly TextBox program, data;
    private readonly Button action;
    private readonly HaloProgress halo;
    private readonly ReleaseVersion version;
    private readonly string shortcutDirectory;
    private readonly object processGate = new object();
    private Process worker;
    private CancellationTokenSource cancellation;
    private bool installing, canCancel, complete, confirmed;
    private string lastProgressDetails;
    private string page = "DestinationPage";
    private double lastProgress;
    private int stage;

    private sealed class ReleaseVersion
    {
        public string version { get; set; }
        public int sequence { get; set; }
        public bool localTest { get; set; }
    }
    private sealed class InstallEvent
    {
        public string step { get; set; }
        public string message { get; set; }
        public long done { get; set; }
        public long total { get; set; }
        public int filesDone { get; set; }
        public int filesTotal { get; set; }
    }

    [STAThread]
    private static void Main(string[] args)
    {
        string fonts = null;
        try
        {
            fonts = Path.Combine(Path.GetTempPath(), "AieyraSetupFonts-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(fonts);
            CopyResource("inter.ttf", Path.Combine(fonts, "inter.ttf"), CancellationToken.None);
            CopyResource("noto.ttf", Path.Combine(fonts, "noto.ttf"), CancellationToken.None);
            var app = new Application();
            using (var markup = Resource("Installer.xaml"))
                app.Run(new Setup((Window)XamlReader.Load(markup), Options(args), fonts).window);
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Aieyra OS 安装器", MessageBoxButton.OK, MessageBoxImage.Error);
            Environment.ExitCode = 1;
        }
        finally
        {
            if (fonts != null) RemoveTemporaryFiles(fonts, "inter.ttf", "noto.ttf");
        }
    }

    private static Dictionary<string, string> Options(string[] args)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        for (int i = 0; i < args.Length; i += 2)
        {
            var key = args[i];
            if (i + 1 >= args.Length || (key != "--program" && key != "--data" && key != "--desktop"))
                throw new ArgumentException("安装器参数无效");
            values.Add(key, args[i + 1]);
        }
        return values;
    }

    private Setup(Window view, Dictionary<string, string> options, string fonts)
    {
        window = view;
        window.FontFamily = new FontFamily(new Uri(fonts + Path.DirectorySeparatorChar),
            "./#Aieyra Setup Inter, ./#Aieyra Setup Noto Sans SC, Microsoft YaHei UI, Segoe UI");
        program = Find<TextBox>("ProgramPath");
        data = Find<TextBox>("DataPath");
        action = Find<Button>("Action");
        halo = new HaloProgress(Find<TextBlock>("ProgressValue"));
        Find<Grid>("HaloHost").Children.Insert(0, halo);
        foreach (var id in new[] { "BrandTitle", "DestinationTitle", "ProgressLabel", "ProgressDetails",
                                  "CompleteTitle", "CompleteDetails", "Edition" })
            Outline(id, .75);
        Outline("ProgressValue", 1.45);
        using (var reader = new StreamReader(Resource("release.json"), Encoding.UTF8))
            version = json.Deserialize<ReleaseVersion>(reader.ReadToEnd());
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        program.Text = Choice(options, "--program", Path.Combine(local, "Programs", "Aieyra OS"));
        data.Text = Choice(options, "--data", Path.Combine(local, "AieyraOS", "UserData"));
        shortcutDirectory = Choice(options, "--desktop", "");
        Find<Label>("ProgramLabel").Target = program;
        Find<Label>("DataLabel").Target = data;
        Find<TextBlock>("Edition").Text = version.version + (version.localTest ? " · 本机验收" : "");
        Find<Image>("BrandMark").Source = Picture("brand.png");
        window.Icon = Find<Image>("BrandMark").Source;
        window.Width = Math.Min(window.Width, SystemParameters.WorkArea.Width - 24);
        window.Height = Math.Min(window.Height, SystemParameters.WorkArea.Height - 24);
        window.SizeChanged += delegate { Fit(); };
        window.StateChanged += delegate { halo.ChangeWindowVisibility(window.WindowState != WindowState.Minimized); };
        window.Closing += OnClosing;
        Find<Button>("ChooseProgram").Click += delegate { Browse(program, "选择程序位置"); };
        Find<Button>("ChooseData").Click += delegate { Browse(data, "选择个人资料位置"); };
        Find<Button>("ExitSetup").Click += delegate { window.Close(); };
        action.Click += RunAction;
        Fit();
    }

    private static string Choice(Dictionary<string, string> options, string key, string fallback)
    {
        string result;
        return options.TryGetValue(key, out result) ? result : fallback;
    }

    private T Find<T>(string id) where T : class { return (T)window.FindName(id); }

    private void Outline(string id, double thickness)
    {
        var label = Find<TextBlock>(id);
        ((Grid)label.Parent).Children.Add(new OutlinedLabel(label, thickness));
    }

    private static Stream Resource(string name)
    {
        var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
        if (stream == null) throw new InvalidDataException("安装器缺少 " + name);
        return stream;
    }

    private static BitmapImage Picture(string name)
    {
        using (var image = Resource(name))
        {
            var result = new BitmapImage();
            result.BeginInit();
            result.CacheOption = BitmapCacheOption.OnLoad;
            result.StreamSource = image;
            result.EndInit();
            result.Freeze();
            return result;
        }
    }

    private void Fit()
    {
        double height = window.ActualHeight > 0 ? window.ActualHeight : window.Height;
        var host = Find<Grid>("HaloHost");
        host.Width = host.Height = Math.Max(156, Math.Min(244, Math.Floor(height * .38)));
        FitContent(false);
    }

    private void FitContent(bool animate)
    {
        double spare = window.ActualHeight - Find<Grid>("HaloHost").Height - (page == "CompletePage" ? 282 : 224);
        double offset = page == "DestinationPage" ? 0 : Math.Max(0, Math.Floor(spare * .46));
        var transform = (TranslateTransform)Find<StackPanel>("InstallerContent").RenderTransform;
        double previous = transform.Y;
        transform.Y = offset;
        if (animate && SystemParameters.ClientAreaAnimation && previous != offset)
            transform.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(previous, offset, TimeSpan.FromMilliseconds(240))
            {
                EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut },
                FillBehavior = FillBehavior.Stop
            });
        else
            transform.BeginAnimation(TranslateTransform.YProperty, null);
    }

    private void Browse(TextBox field, string prompt)
    {
        using (var picker = new Forms.FolderBrowserDialog())
        {
            picker.Description = prompt;
            picker.ShowNewFolderButton = true;
            if (Directory.Exists(field.Text)) picker.SelectedPath = field.Text;
            if (picker.ShowDialog(new WindowOwner(window)) == Forms.DialogResult.OK) field.Text = picker.SelectedPath;
        }
        field.Focus();
    }

    private sealed class WindowOwner : Forms.IWin32Window
    {
        private readonly Window window;
        internal WindowOwner(Window owner) { window = owner; }
        public IntPtr Handle { get { return new System.Windows.Interop.WindowInteropHelper(window).Handle; } }
    }

    private void Show(string page)
    {
        this.page = page;
        Find<Button>("ExitSetup").Visibility = page == "DestinationPage" ? Visibility.Visible : Visibility.Collapsed;
        foreach (var name in new[] { "DestinationPage", "ProgressPage", "CompletePage" })
        {
            var view = Find<StackPanel>(name);
            bool visible = page == name;
            view.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
            if (visible && SystemParameters.ClientAreaAnimation)
                view.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(.5, 1, TimeSpan.FromMilliseconds(180)));
        }
        FitContent(true);
    }

    private void OnClosing(object sender, CancelEventArgs args)
    {
        if (installing || complete && !confirmed)
        {
            args.Cancel = true;
            if (installing && canCancel) Cancel();
        }
    }

    private void Cancel()
    {
        canCancel = false;
        action.IsEnabled = false;
        SetProgress("正在取消", lastProgressDetails, lastProgress, false);
        cancellation.Cancel();
        lock (processGate)
        {
            if (worker != null && !worker.HasExited)
            {
                try { worker.StandardInput.WriteLine("cancel"); worker.StandardInput.Flush(); }
                catch (IOException) { }
                catch (InvalidOperationException) { }
            }
        }
    }

    private async void RunAction(object sender, RoutedEventArgs args)
    {
        if (complete)
        {
            confirmed = true;
            window.Close();
            return;
        }
        if (installing)
        {
            if (canCancel) Cancel();
            return;
        }
        string programPath, dataPath, desktopPath;
        try
        {
            programPath = AbsoluteDirectory(program.Text);
            dataPath = AbsoluteDirectory(data.Text);
            desktopPath = shortcutDirectory.Length == 0 ? "" : AbsoluteDirectory(shortcutDirectory);
        }
        catch (Exception error)
        {
            Find<TextBlock>("InputError").Text = error.Message;
            return;
        }
        Find<TextBlock>("InputError").Text = "";
        installing = canCancel = true;
        stage = 0;
        lastProgress = 0;
        lastProgressDetails = "";
        cancellation = new CancellationTokenSource();
        Show("ProgressPage");
        action.Content = "取消安装";
        action.IsDefault = false;
        action.IsEnabled = true;
        SetProgress("准备安装文件", "", 0, true);
        bool shortcuts = Find<CheckBox>("Shortcuts").IsChecked == true;
        try
        {
            var token = cancellation.Token;
            var result = await Task.Run(() => Install(programPath, dataPath, desktopPath, shortcuts, token));
            complete = true;
            Find<TextBlock>("CompleteLocation").Text = programPath;
            Find<TextBlock>("CompleteNotice").Text = result.message;
            Find<TextBlock>("CompleteDetails").Text = lastProgressDetails;
            halo.ShowProgress(100, false, window.WindowState != WindowState.Minimized);
            Show("CompletePage");
            action.Content = "确认";
        }
        catch (Exception error)
        {
            Show("DestinationPage");
            Find<TextBlock>("InputError").Text = cancellation.IsCancellationRequested ? "安装已取消。" : error.Message;
            action.Content = "开始安装";
            halo.Reset();
        }
        finally
        {
            installing = false;
            action.IsEnabled = true;
            action.IsDefault = !complete;
            cancellation.Dispose();
            cancellation = null;
        }
    }

    private static string AbsoluteDirectory(string value)
    {
        value = value.Trim();
        if (value.Length < 4 || value[1] != ':' || (value[2] != '\\' && value[2] != '/') || value.Contains("\""))
            throw new ArgumentException("请输入本机磁盘上的完整目录。");
        return Path.GetFullPath(value).TrimEnd('\\', '/');
    }

    private static string Quote(string value) { return "\"" + value + "\""; }

    private InstallEvent Install(string root, string personal, string desktop, bool shortcuts, CancellationToken token)
    {
        var temporary = Path.Combine(Path.GetTempPath(), "AieyraSetup-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temporary);
        var archive = Path.Combine(temporary, "payload.zip");
        var engine = Path.Combine(temporary, "install.exe");
        try
        {
            CopyResource("payload.zip", archive, token);
            CopyResource("install.exe", engine, token);
            token.ThrowIfCancellationRequested();
            var settings = new ProcessStartInfo(engine)
            {
                Arguments = "-archive " + Quote(archive) + " -program " + Quote(root) + " -data " + Quote(personal) +
                    " -version " + version.version + " -sequence " + version.sequence.ToString(System.Globalization.CultureInfo.InvariantCulture) +
                    " -interactive -shortcuts=" + (shortcuts ? "true" : "false") +
                    (desktop.Length != 0 ? " -desktop " + Quote(desktop) : ""),
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true,
                RedirectStandardOutput = true, StandardOutputEncoding = Encoding.UTF8, WorkingDirectory = temporary
            };
            using (var process = new Process { StartInfo = settings })
            {
                lock (processGate)
                {
                    token.ThrowIfCancellationRequested();
                    process.Start();
                    worker = process;
                }
                InstallEvent final = null;
                try
                {
                    string line;
                    while ((line = process.StandardOutput.ReadLine()) != null)
                    {
                        var current = json.Deserialize<InstallEvent>(line);
                        if (current.step == "complete" || current.step == "error") final = current;
                        else if (current.step == "profile")
                        {
                            var commit = window.Dispatcher.Invoke(new Func<bool>(() =>
                            {
                                if (token.IsCancellationRequested) return false;
                                OnProgress(current);
                                return true;
                            }));
                            if (commit)
                            {
                                process.StandardInput.WriteLine("commit");
                                process.StandardInput.Flush();
                            }
                        }
                        else window.Dispatcher.BeginInvoke(new Action(() => OnProgress(current)));
                    }
                    process.WaitForExit();
                    if (process.ExitCode != 0 || final == null || final.step != "complete")
                        throw new InvalidOperationException(final != null && !String.IsNullOrWhiteSpace(final.message)
                            ? final.message : "安装中断。请重新打开安装器再试。");
                    return final;
                }
                finally { lock (processGate) worker = null; }
            }
        }
        finally
        {
            RemoveTemporaryFiles(temporary, "install.exe", "payload.zip");
        }
    }

    private static void RemoveTemporaryFiles(string directory, params string[] names)
    {
        try
        {
            foreach (var name in names) File.Delete(Path.Combine(directory, name));
            Directory.Delete(directory);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private static void CopyResource(string name, string target, CancellationToken token)
    {
        using (var input = Resource(name))
        using (var output = File.Open(target, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        {
            var buffer = new byte[1024 * 1024];
            int read;
            while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
            {
                token.ThrowIfCancellationRequested();
                output.Write(buffer, 0, read);
            }
        }
    }

    private void OnProgress(InstallEvent value)
    {
        if (!installing || cancellation.IsCancellationRequested) return;
        switch (value.step)
        {
            case "verify":
                SetProgress("核对发行签名", "", 0, true);
                break;
            case "extract":
                if (stage > 1 || value.total <= 0) break;
                stage = 1;
                double fraction = (double)value.done / value.total;
                SetProgress("写入程序文件",
                    String.Format("{0:N1} / {1:N1} MB  ·  {2:N0} / {3:N0} 个文件",
                        value.done / 1000000.0, value.total / 1000000.0, value.filesDone, value.filesTotal),
                    fraction * 96, false);
                break;
            case "profile":
                stage = 2;
                canCancel = false;
                action.IsEnabled = false;
                SetProgress("准备个人资料", lastProgressDetails, 98, false);
                break;
            case "shortcuts":
                SetProgress("创建快捷方式", lastProgressDetails, 99, false);
                break;
        }
    }

    private void SetProgress(string label, string detail, double percent, bool pending)
    {
        Find<TextBlock>("ProgressLabel").Text = label;
        Find<TextBlock>("ProgressDetails").Text = detail;
        lastProgressDetails = detail;
        lastProgress = percent;
        halo.ShowProgress(percent, pending, window.WindowState != WindowState.Minimized);
    }
}
