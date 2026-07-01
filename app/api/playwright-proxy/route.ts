import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";

const execAsync = promisify(exec);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { url, action } = await req.json();
  try {
    const { stdout } = await execAsync(`cd /home/kali/HackWithAI && python3 -c "
import sys, json; sys.path.insert(0,'.')
from tools.playwright_automation import BrowserAutomation, WebCrawler
ba = BrowserAutomation(headless=True)
if ba.launch():
  ${action === 'crawl' ? `
  crawler = WebCrawler(ba)
  results = crawler.crawl('${url}', depth=1, max_pages=10)
  path = crawler.export()
  print(json.dumps({'crawled': len(results), 'path': path}))
  ` : action === 'xss' ? `
  r = ba.detect_xss('${url}')
  print(json.dumps(r))
  ` : action === 'forms' ? `
  ba.navigate('${url}')
  forms = ba.extract_forms()
  print(json.dumps({'forms': len(forms), 'data': forms}))
  ` : `
  r = ba.navigate('${url}')
  links = ba.extract_links()
  print(json.dumps({'title': r.get('title',''), 'links': len(links)}))
  `}
  ba.close()
else:
  print(json.dumps({'error': 'browser launch failed'}))
"`, { timeout: 30000 });
    try {
      return NextResponse.json(JSON.parse(stdout.trim() || '{}'));
    } catch {
      return NextResponse.json({ result: stdout.trim(), raw: true });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
