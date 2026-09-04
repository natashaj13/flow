# Homebrew formula for Flow.
#
# Install from a local checkout:   brew install --build-from-source ./flow.rb
# Install straight from GitHub:    brew install --HEAD ./flow.rb
#
# (Homebrew requires the file name to match the formula name, so this file
# must stay `flow.rb`.)
class Flow < Formula
  desc "Save and restore your working context: VS Code windows + Chrome tabs"
  homepage "https://github.com/natashaj13/flow"
  url "https://github.com/natashaj13/flow/archive/refs/heads/main.tar.gz"
  version "0.1.0"
  head "https://github.com/natashaj13/flow.git", branch: "main"

  depends_on "node"

  def install
    # Homebrew's build sandbox can't write to ~/.npm — keep npm/npx caches
    # inside the build directory.
    ENV["npm_config_cache"] = "#{buildpath}/.npm_cache"

    libexec.install Dir["*"]

    # The CLI resolves the hub as ../../hub/index.js from cli/bin, so the repo
    # layout must be preserved inside libexec.
    cd libexec/"cli" do
      system "npm", "install", "--omit=dev", "--no-audit", "--no-fund"
    end
    cd libexec/"hub" do
      system "npm", "install", "--omit=dev", "--no-audit", "--no-fund"
    end

    # Build the VS Code extension into a .vsix. vsce prompts y/N on some
    # warnings (e.g. no LICENSE file); `yes` answers them non-interactively.
    cd libexec/"vscode" do
      system "npm", "install", "--no-audit", "--no-fund"
      system "bash", "-c",
             "yes | npx --yes @vscode/vsce package --allow-missing-repository --out flow.vsix"
    end

    chmod 0755, libexec/"cli/bin/flow.js"
    bin.install_symlink libexec/"cli/bin/flow.js" => "flow"
  end

  def post_install
    vsix = libexec/"vscode/flow.vsix"
    code = which("code") ||
           Pathname.new("/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code")
    if code.exist?
      system code.to_s, "--install-extension", vsix.to_s, "--force"
      ohai "Installed the Flow VS Code extension"
    else
      opoo "Couldn't find the `code` CLI — install the VS Code extension " \
           "manually (see the caveats below / `brew info flow`)"
    end
  end

  def caveats
    <<~EOS
      VS Code extension:
        Installed automatically if the `code` CLI was found. If VS Code doesn't
        list "Flow" under Extensions, install it manually with:
          code --install-extension #{opt_libexec}/vscode/flow.vsix --force

      Chrome extension — YOU NEED TO INSTALL THIS MANUALLY (Chrome doesn't
      allow scripted installs of unpacked extensions):
        1. Open chrome://extensions and turn on "Developer mode"
        2. Click "Load unpacked" and select:
             #{opt_libexec}/chrome
        3. Repeat in every Chrome profile whose tabs you want captured.

      Optional (macOS): to let Flow skip minimized VS Code windows during a
      save, grant VS Code the Accessibility permission under
      System Settings → Privacy & Security → Accessibility.
      Without it, minimized windows are simply included in saves too.

      Then:
        flow save my-work -m "what I was doing"
        flow load my-work
    EOS
  end

  test do
    assert_match "save", shell_output("#{bin}/flow --help")
  end
end
