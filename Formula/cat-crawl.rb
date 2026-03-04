class CatCrawl < Formula
  desc "Multi-channel bot to crawl WeChat articles and save to Obsidian"
  homepage "https://github.com/your-org/cat-crawl"
  url "https://registry.npmjs.org/cat-crawl/-/cat-crawl-0.1.0.tgz"
  sha256 "REPLACE_WITH_REAL_SHA256"
  license "MIT"

  depends_on "node" => ">=22"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec/"bin/cat-crawl"
  end

  test do
    output = shell_output("#{bin}/cat-crawl 2>&1", 1)
    assert_match "Usage", output
  end
end
