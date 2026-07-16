#!/usr/bin/env python3
"""
HackWithAI - Burp Suite + Playwright Integration
Lio's Automated Pentest Workflow

Controls:
  - Burp REST API (port 1337) → Scanning, Issues, Config
  - Burp Proxy (port 8080)     → Traffic Interception
  - Playwright                 → Browser Automation + Session Capture
  - Burp CA Cert               → HTTPS Interception without errors
"""

import asyncio
import json
import sys
import time
import argparse
from pathlib import Path
from urllib.parse import urlparse, urljoin
from typing import Optional
import requests
from playwright.async_api import async_playwright, Browser, BrowserContext, Page

# ============================================================
# CONFIGURATION
# ============================================================
BURP_API = "http://127.0.0.1:1337/v0.1"
BURP_PROXY = "http://127.0.0.1:8080"
BURP_CERT = "/home/kali/Downloads/burp_cert.pem"
OUTPUT_DIR = Path("/home/kali/HackWithAI/output")

class BurpAPIClient:
    """Burp Suite REST API v0.1 Client"""

    def __init__(self, base_url: str = BURP_API):
        self.base_url = base_url
        self.session = requests.Session()

    def scan(self, urls: list, scan_type: str = "active") -> dict:
        """Start a scan on target URLs"""
        payload = {
            "scan": {
                "urls": urls if isinstance(urls, list) else [urls],
                "scan_type": scan_type
            }
        }
        try:
            r = self.session.post(f"{self.base_url}/scan", json=payload)
            location = r.headers.get("Location", "")
            task_id = location.split("/")[-1] if location else None
            return {"status": r.status_code, "task_id": task_id, "location": location}
        except Exception as e:
            return {"error": str(e)}

    def scan_status(self, task_id: str) -> dict:
        """Check scan progress"""
        try:
            r = self.session.get(f"{self.base_url}/scan/{task_id}")
            return r.json() if r.status_code == 200 else {"error": r.text}
        except Exception as e:
            return {"error": str(e)}

    def get_issue_definitions(self) -> list:
        """Get all issue definitions"""
        try:
            r = self.session.get(f"{self.base_url}/issue_definitions")
            return r.json() if r.status_code == 200 else []
        except:
            return []

    def wait_for_scan(self, task_id: str, poll_interval: int = 5, timeout: int = 300):
        """Wait for scan completion"""
        start = time.time()
        while time.time() - start < timeout:
            status = self.scan_status(task_id)
            print(f"  [Scan] Task {task_id}: {json.dumps(status, indent=2)[:200]}")
            if status.get("scan_complete"):
                return status
            time.sleep(poll_interval)
        return {"error": "timeout"}


class BrowserSession:
    """Playwright Browser Session through Burp Proxy"""

    def __init__(self, headless: bool = False):
        self.headless = headless
        self.playwright = None
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.pages: list = []
        self.captured_requests: list = []
        self.captured_responses: list = []
        self.cookies_jar: list = []

    async def start(self):
        """Launch browser with Burp Proxy"""
        self.playwright = await async_playwright().start()

        launch_args = [
            f"--proxy-server={BURP_PROXY}",
            "--ignore-certificate-errors",
            "--disable-web-security",
            "--disable-features=HttpsUpgrades",
        ]

        self.browser = await self.playwright.chromium.launch(
            headless=self.headless,
            args=launch_args,
        )

        self.context = await self.browser.new_context(
            ignore_https_errors=True,
            viewport={"width": 1920, "height": 1080},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )

        self.context.on("request", self._on_request)
        self.context.on("response", self._on_response)

        print(f"[Browser] Launched with Burp Proxy: {BURP_PROXY}")
        return self

    async def _on_request(self, request):
        self.captured_requests.append({
            "url": request.url,
            "method": request.method,
            "headers": dict(request.headers),
            "timestamp": time.time(),
        })

    async def _on_response(self, response):
        try:
            body = await response.body()
        except:
            body = b""
        self.captured_responses.append({
            "url": response.url,
            "status": response.status,
            "headers": dict(response.headers),
            "body_size": len(body),
            "timestamp": time.time(),
        })

    async def new_page(self) -> Page:
        page = await self.context.new_page()
        self.pages.append(page)
        return page

    async def navigate(self, url: str, wait_until: str = "networkidle") -> Page:
        """Open a new page and navigate to URL"""
        page = await self.new_page()
        print(f"[Navigate] -> {url}")
        try:
            await page.goto(url, wait_until=wait_until, timeout=30000)
        except Exception as e:
            print(f"[Navigate] Warning: {e}")
        return page

    async def capture_session(self, url: str) -> dict:
        """Navigate to URL and capture full session data"""
        page = await self.navigate(url)
        await asyncio.sleep(2)

        cookies = await self.context.cookies()
        self.cookies_jar.extend(cookies)

        local_storage = await page.evaluate("() => JSON.stringify(localStorage)")
        session_storage = await page.evaluate("() => JSON.stringify(sessionStorage)")

        title = await page.title()
        current_url = page.url

        screenshot_path = OUTPUT_DIR / f"screenshot_{int(time.time())}.png"
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        await page.screenshot(path=str(screenshot_path), full_page=True)

        result = {
            "url": current_url,
            "title": title,
            "cookies": cookies,
            "localStorage": json.loads(local_storage) if local_storage != "null" else {},
            "sessionStorage": json.loads(session_storage) if session_storage != "null" else {},
            "screenshot": str(screenshot_path),
            "requests_count": len(self.captured_requests),
            "responses_count": len(self.captured_responses),
        }

        print(f"[Session] Captured: {len(cookies)} cookies, {result['requests_count']} requests")
        return result

    async def extract_tokens(self) -> dict:
        """Extract auth tokens from captured requests"""
        tokens = {
            "bearer": [],
            "jwt": [],
            "api_key": [],
            "session_cookie": [],
            "csrf": [],
            "custom_headers": [],
        }

        for req in self.captured_requests:
            headers = req.get("headers", {})
            auth = headers.get("authorization", "")
            if auth.startswith("Bearer "):
                tokens["bearer"].append({"url": req["url"], "token": auth[7:]})
            if auth.startswith("JWT "):
                tokens["jwt"].append({"url": req["url"], "token": auth[4:]})

            for key, val in headers.items():
                if key.lower() in ("x-api-key", "api-key", "apikey"):
                    tokens["api_key"].append({"url": req["url"], "header": key, "value": val})
                if key.lower() in ("x-csrf-token", "x-xsrf-token", "csrf-token"):
                    tokens["csrf"].append({"url": req["url"], "header": key, "value": val})

        for cookie in self.cookies_jar:
            if cookie.get("name", "").lower() in ("session", "sessionid", "jsessionid", "phpsessid", "auth", "token"):
                tokens["session_cookie"].append(cookie)

        return tokens

    async def save_har(self, filename: str = None):
        """Save captured traffic as HAR file"""
        if not filename:
            filename = f"traffic_{int(time.time())}.har"
        filepath = OUTPUT_DIR / filename
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

        har = {
            "log": {
                "version": "1.2",
                "creator": {"name": "HackWithAI", "version": "2.0"},
                "entries": []
            }
        }
        for req, resp in zip(self.captured_requests, self.captured_responses):
            har["log"]["entries"].append({
                "request": req,
                "response": resp,
                "startedDateTime": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(req["timestamp"])),
            })

        filepath.write_text(json.dumps(har, indent=2))
        print(f"[HAR] Saved: {filepath} ({len(har['log']['entries'])} entries)")
        return str(filepath)

    async def close(self):
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
        print("[Browser] Closed")


class PentestWorkflow:
    """Automated Pentest Workflow"""

    def __init__(self, target: str):
        self.target = target
        self.burp = BurpAPIClient()
        self.browser: Optional[BrowserSession] = None
        self.results = {}

    async def run_full(self):
        """Run complete automated pentest workflow"""
        print(f"""
╔══════════════════════════════════════════╗
║   HackWithAI - Automated Pentest        ║
║   Target: {self.target:<30} ║
╚══════════════════════════════════════════╝
""")

        # Phase 1: Browser Session Capture
        print("\n[Phase 1] Browser Session Capture")
        print("-" * 50)
        self.browser = await BrowserSession(headless=False).start()

        session_data = await self.browser.capture_session(self.target)
        self.results["session"] = session_data

        tokens = await self.browser.extract_tokens()
        self.results["tokens"] = tokens
        print(f"\n[Tokens Found]:")
        for token_type, items in tokens.items():
            if items:
                print(f"  {token_type}: {len(items)} found")

        har_path = await self.browser.save_har()
        self.results["har"] = har_path

        # Phase 2: Burp Scanning
        print("\n[Phase 2] Burp Suite Scanning")
        print("-" * 50)
        scan_result = self.burp.scan([self.target], "active")
        self.results["scan"] = scan_result
        print(f"  Scan started: {scan_result}")

        if scan_result.get("task_id"):
            print(f"  Waiting for scan to complete...")
            scan_status = self.burp.wait_for_scan(scan_result["task_id"])
            self.results["scan_status"] = scan_status

        # Phase 3: Save Results
        print("\n[Phase 3] Saving Results")
        print("-" * 50)
        report_path = OUTPUT_DIR / f"pentest_report_{int(time.time())}.json"
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(self.results, indent=2, default=str))
        print(f"  Report saved: {report_path}")

        print(f"""
╔══════════════════════════════════════════╗
║   Pentest Complete!                     ║
║   Requests Captured: {len(self.browser.captured_requests):<5}            ║
║   Responses Captured: {len(self.browser.captured_responses):<5}            ║
║   Cookies: {len(session_data.get('cookies', [])):<5}                       ║
║   Tokens: {sum(len(v) for v in tokens.values()):<5}                        ║
║   HAR: {har_path:<30} ║
║   Report: {str(report_path):<30} ║
╚══════════════════════════════════════════╝
""")

        return self.results

    async def quick_session_grab(self):
        """Quick: Just grab session without scanning"""
        self.browser = await BrowserSession(headless=True).start()
        session = await self.browser.capture_session(self.target)
        tokens = await self.browser.extract_tokens()
        await self.browser.close()

        return {
            "session": session,
            "tokens": tokens,
        }

    async def close(self):
        if self.browser:
            await self.browser.close()


# ============================================================
# CLI
# ============================================================
async def main():
    parser = argparse.ArgumentParser(description="HackWithAI - Burp + Playwright Integration")
    parser.add_argument("target", help="Target URL (e.g., https://example.com)")
    parser.add_argument("--mode", choices=["full", "session", "scan"], default="full",
                        help="Mode: full (default), session-only, scan-only")
    parser.add_argument("--headless", action="store_true", help="Run browser in headless mode")
    args = parser.parse_args()

    workflow = PentestWorkflow(args.target)

    try:
        if args.mode == "session":
            result = await workflow.quick_session_grab()
            print(json.dumps(result, indent=2, default=str))
        elif args.mode == "scan":
            burp = BurpAPIClient()
            result = burp.scan([args.target])
            print(json.dumps(result, indent=2))
            if result.get("task_id"):
                burp.wait_for_scan(result["task_id"])
        else:
            await workflow.run_full()
    finally:
        await workflow.close()


if __name__ == "__main__":
    asyncio.run(main())