// Hero-Tavern: transparent bootstrap for the PowerShell installer.
// MIT licensed. Does not bundle SillyTavern, Node.js, KoboldCpp or model weights.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

internal static class Bootstrap
{
    private static void ExtractResource(string resourceName, string outputPath)
    {
        using (var source = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName))
        {
            if (source == null) throw new InvalidOperationException("Missing resource: " + resourceName);
            using (var destination = File.Create(outputPath)) source.CopyTo(destination);
        }
    }

    private static int Main(string[] args)
    {
        string tempDirectory = null;
        try
        {
            tempDirectory = Path.Combine(Path.GetTempPath(), "HeroTavern-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempDirectory);
            var scriptPath = Path.Combine(tempDirectory, "Install.ps1");
            using (var source = Assembly.GetExecutingAssembly().GetManifestResourceStream("InstallScript"))
            {
                if (source == null)
                {
                    Console.Error.WriteLine("Installer resource is missing.");
                    return 1;
                }
                using (var destination = File.Create(scriptPath))
                {
                    source.CopyTo(destination);
                }
            }
            ExtractResource("ModelManagerScript", Path.Combine(tempDirectory, "ModelManager.ps1"));
            ExtractResource("LocalAILaunchScript", Path.Combine(tempDirectory, "LaunchLocalAI.ps1"));
            foreach (var filename in new[] { "StartHeroTavern.ps1", "ModelTools.ps1", "models.json", "ConfigureTavern.cjs", "ModelBridge.cjs", "ModelPanel.html", "ReplyPipeline.cjs", "ReplyFilters.cjs", "ContextMemory.cjs", "ImageService.cjs", "Adventure.html", "AdventureAdapter.js", "spells.json", "AutoTune.cjs", "EngineHTTP.cjs", "Performance.cjs", "ImageStudio.cjs", "ComfyAdapter.cjs", "ComfyWorkflows.cjs", "ComfyWorkflowLibrary.cjs", "EngineShutdown.cjs", "EngineRuntime.cjs", "DiskCare.cjs", "ImageGallery.cjs", "HeroImages.js", "ModelProfiles.cjs", "StoryState.cjs", "StoryStore.cjs", "StoryAPI.cjs", "ThinkingWorker.cjs", "StoryPanel.js", "CreatorPanel.js", "HeroStory.js", "HeroExtension.js", "HeroExtension.json" })
                ExtractResource(filename, Path.Combine(tempDirectory, filename));
            Console.WriteLine("Hero Tavern - SillyTavern + KoboldCpp + Qwen");
            Console.WriteLine("Starting published installer script...");
            string shell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
                @"WindowsPowerShell\v1.0\powershell.exe");
            var info = new ProcessStartInfo
            {
                FileName = shell,
                Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + scriptPath + "\"",
                UseShellExecute = false,
                CreateNoWindow = false,
                WorkingDirectory = tempDirectory
            };
            using (var process = Process.Start(info))
            {
                if (process == null) throw new InvalidOperationException("Could not start Windows PowerShell.");
                process.WaitForExit();
                return process.ExitCode;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Installer failed: " + ex.Message);
            Console.WriteLine("Press Enter to close.");
            Console.ReadLine();
            return 1;
        }
        finally
        {
            if (!string.IsNullOrEmpty(tempDirectory))
            {
                try { Directory.Delete(tempDirectory, true); } catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
        }
    }
}
