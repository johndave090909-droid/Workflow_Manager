"""
Full-page (or element-targeted) website screenshot using Selenium + Chrome.

Usage:
  python screenshot.py <url> [output_filename] [css_selector]

Examples:
  python screenshot.py https://example.com
  python screenshot.py https://example.com my-screenshot.png
  python screenshot.py https://example.com guest-counts.png "#guest-counts-section"

If no URL is given, defaults to https://nidl3r.github.io/PCC-KDS/
If no filename is given, saves as screenshot.png in the current directory.
If a CSS selector is given, only that element is captured (not the full page).
"""

import sys
import os
import time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.by import By

# ── Arguments ─────────────────────────────────────────────────────────────────
URL      = sys.argv[1] if len(sys.argv) > 1 else "https://nidl3r.github.io/PCC-KDS/"
OUTPUT   = sys.argv[2] if len(sys.argv) > 2 else "screenshot.png"
SELECTOR = sys.argv[3] if len(sys.argv) > 3 else ""

# Ensure .png extension
if not OUTPUT.lower().endswith(".png"):
    OUTPUT += ".png"

# ── Chrome options ─────────────────────────────────────────────────────────────
def build_options() -> Options:
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")               # required on Linux / GitHub Actions
    opts.add_argument("--disable-dev-shm-usage")    # prevents crashes on low-memory runners
    opts.add_argument("--disable-gpu")
    opts.add_argument("--hide-scrollbars")
    opts.add_argument("--window-size=1440,900")
    opts.add_argument("--force-device-scale-factor=1")
    return opts

# ── Main ───────────────────────────────────────────────────────────────────────
def take_screenshot(url: str, output: str, selector: str) -> None:
    print(f"Target   : {url}")
    print(f"Output   : {output}")
    if selector:
        print(f"Selector : {selector}")

    driver = webdriver.Chrome(options=build_options())

    try:
        driver.get(url)

        # Wait for page body to appear
        WebDriverWait(driver, 20).until(
            EC.presence_of_element_located((By.TAG_NAME, "body"))
        )

        # Extra wait for JS / animations to settle
        time.sleep(2.5)

        if selector:
            # ── Element-targeted screenshot ──────────────────────────────────
            try:
                element = WebDriverWait(driver, 10).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, selector))
                )
                # Scroll element into view
                driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", element)
                time.sleep(0.5)
                element.screenshot(output)
                size_kb = os.path.getsize(output) / 1024
                print(f"✓ Saved element screenshot : {output}  ({size_kb:.1f} KB)")
            except Exception as e:
                print(f"⚠ Selector '{selector}' not found ({e}), falling back to full page.")
                _full_page(driver, output)
        else:
            # ── Full-page screenshot ─────────────────────────────────────────
            _full_page(driver, output)

    finally:
        driver.quit()


def _full_page(driver, output: str) -> None:
    total_width = driver.execute_script(
        "return Math.max(document.body.scrollWidth, document.documentElement.scrollWidth, "
        "document.body.offsetWidth, document.documentElement.offsetWidth, "
        "document.body.clientWidth, document.documentElement.clientWidth);"
    )
    total_height = driver.execute_script(
        "return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, "
        "document.body.offsetHeight, document.documentElement.offsetHeight, "
        "document.body.clientHeight, document.documentElement.clientHeight);"
    )
    print(f"Page     : {total_width} x {total_height} px")
    driver.set_window_size(total_width, total_height)
    time.sleep(0.5)
    success = driver.get_screenshot_as_file(output)
    if success:
        size_kb = os.path.getsize(output) / 1024
        print(f"✓ Saved  : {output}  ({size_kb:.1f} KB)")
    else:
        print("✗ Screenshot failed.")
        sys.exit(1)


if __name__ == "__main__":
    take_screenshot(URL, OUTPUT, SELECTOR)
