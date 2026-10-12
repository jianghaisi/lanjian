// Fixed, independently verified Windows CPU runtime; never resolve live dependencies.
export const runtimeProfile = {
  "id": "cpython-3.12.14-llama-0.3.19-win-x64-cpu-v1",
  "platform": "win32",
  "arch": "x64",
  "python": "python/python.exe",
  "sitePackages": "site-packages",
  "files": [
    {
      "name": "python.tar.gz",
      "url": "https://github.com/astral-sh/python-build-standalone/releases/download/20260929/cpython-3.12.14%2B20260929-x86_64-pc-windows-msvc-install_only_stripped.tar.gz",
      "bytes": 21992568,
      "sha256": "f38e68f4d612ade6dd50c894fc80b14c0be0c3b5201145d6fff5f20b9323204d",
      "format": "tar.gz",
      "target": "",
      "license": "Python-2.0 and bundled third-party licenses",
      "expandedBytes": 63185538
    },
    {
      "name": "llama_cpp_python-0.3.19-cp312-cp312-win_amd64.whl",
      "url": "https://github.com/abetlen/llama-cpp-python/releases/download/v0.3.19/llama_cpp_python-0.3.19-cp312-cp312-win_amd64.whl",
      "bytes": 4523734,
      "sha256": "1843b30d90e35296dbd9bd0b2b753b42f0fafa6aec6d2b1c0fff352f801bc89b",
      "format": "zip",
      "target": "site-packages",
      "license": "MIT",
      "expandedBytes": 16670963
    },
    {
      "name": "numpy-2.5.3-cp312-cp312-win_amd64.whl",
      "url": "https://files.pythonhosted.org/packages/3c/a1/accf6d4f0c80c5d9ba9735d6b1550e444180599f34dec69ca01360f717ad/numpy-2.5.3-cp312-cp312-win_amd64.whl",
      "bytes": 12567828,
      "sha256": "0a59a421a32580a009e8a1751345bf829631b990dc1794b80514ab722b435def",
      "format": "zip",
      "target": "site-packages",
      "license": "BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0",
      "expandedBytes": 41918931
    },
    {
      "name": "diskcache-5.6.3-py3-none-any.whl",
      "url": "https://files.pythonhosted.org/packages/3f/27/4570e78fc0bf5ea0ca45eb1de3818a23787af9b390c0b0a0033a1b8236f9/diskcache-5.6.3-py3-none-any.whl",
      "bytes": 45550,
      "sha256": "5e31b2d5fbad117cc363ebaf6b689474db18a1f6438bc82358b024abd4c2ca19",
      "format": "zip",
      "target": "site-packages",
      "license": "Apache 2.0",
      "expandedBytes": 193668
    },
    {
      "name": "typing_extensions-4.16.0-py3-none-any.whl",
      "url": "https://files.pythonhosted.org/packages/49/d3/b8441a820a491ddfc024b0b0cf0393375b75ea13866d9c66727e54c2fc80/typing_extensions-4.16.0-py3-none-any.whl",
      "bytes": 45571,
      "sha256": "481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8",
      "format": "zip",
      "target": "site-packages",
      "license": "PSF-2.0",
      "expandedBytes": 182767
    },
    {
      "name": "jinja2-3.1.6-py3-none-any.whl",
      "url": "https://files.pythonhosted.org/packages/62/a1/3d680cbfd5f4b8f15abc1d571870c5fc3e594bb582bc3b64ea099db13e56/jinja2-3.1.6-py3-none-any.whl",
      "bytes": 134899,
      "sha256": "85ece4451f492d0c13c5dd7c13a64681a86afae63a5f347908daf103ce6d2f67",
      "format": "zip",
      "target": "site-packages",
      "license": "See bundled license",
      "expandedBytes": 496892
    },
    {
      "name": "markupsafe-3.0.3-cp312-cp312-win_amd64.whl",
      "url": "https://files.pythonhosted.org/packages/aa/5b/bec5aa9bbbb2c946ca2733ef9c4ca91c91b6a24580193e891b5f7dbe8e1e/markupsafe-3.0.3-cp312-cp312-win_amd64.whl",
      "bytes": 15105,
      "sha256": "26a5784ded40c9e318cfc2bdb30fe164bdb8665ded9cd64d500a34fb42067b1c",
      "format": "zip",
      "target": "site-packages",
      "license": "BSD-3-Clause",
      "expandedBytes": 37023
    }
  ]
} as const
