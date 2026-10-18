import os
from pathlib import Path
from playwright.sync_api import sync_playwright
base = os.environ['OML_SMOKE_DASHBOARD_URL'].rstrip('/')
with sync_playwright() as p:
    candidates = [
        Path(os.environ.get('PROGRAMFILES', 'C:/Program Files')) / 'Google/Chrome/Application/chrome.exe',
        Path(os.environ.get('PROGRAMFILES', 'C:/Program Files')) / 'Microsoft/Edge/Application/msedge.exe',
        Path(os.environ.get('PROGRAMFILES(X86)', 'C:/Program Files (x86)')) / 'Microsoft/Edge/Application/msedge.exe',
    ]
    executable = next((path for path in candidates if path.exists()), None)
    browser = p.chromium.launch(headless=True, **({'executable_path': str(executable)} if executable else {}))
    try:
        context = browser.new_context(viewport={'width': 1440, 'height': 960})
        page = context.new_page()
        failures = []
        page.on('pageerror', lambda error: failures.append(type(error).__name__))
        page.goto(base + '/sign-in')
        page.wait_for_load_state('networkidle')
        assert page.get_by_role('heading', name='Welcome back').is_visible()
        assert page.get_by_text('Tracebloom', exact=True).first.is_visible()
        print('PASS browser sign-in form renders: ' + ', '.join(page.locator('label').all_text_contents()))
        artifact = Path.cwd().parent / 'artifacts'
        artifact.mkdir(exist_ok=True)
        page.screenshot(path=str(artifact / 'sign-in.png'), full_page=True)
        page.get_by_label('Email', exact=True).fill(os.environ['OML_SMOKE_EMAIL'])
        page.get_by_label('Password', exact=True).fill(os.environ['OML_SMOKE_PASSWORD'])
        page.get_by_role('button', name='Sign in', exact=True).click()
        page.get_by_text('Free personal account', exact=True).wait_for(timeout=30000)
        cookies = context.cookies()
        session = [c for c in cookies if c['name'] in ('oml_access', 'oml_refresh')]
        assert len(session) == 2 and all(c['httpOnly'] and c['sameSite'] == 'Lax' for c in session)
        assert 'oml_access' not in page.evaluate('document.cookie')
        print('PASS browser login uses HttpOnly session cookies')
        result = context.request.post(base + '/api/v1/api-keys', headers={'Origin': 'https://untrusted.example'}, data={})
        assert result.status == 403
        print('PASS frontend rejects cross-origin account mutations')
        page.get_by_role('link', name='Settings', exact=True).click()
        page.get_by_role('heading', name='Account and usage').wait_for()
        page.get_by_text('Daily allowance', exact=True).wait_for()
        print('PASS browser account and usage settings load')
        page.get_by_role('link', name='Live Logs', exact=True).click()
        page.get_by_text('Cloud smoke 0', exact=True).first.wait_for(timeout=30000)
        print('PASS dashboard receives real log history through its authenticated SSE proxy')
        page.get_by_role('link', name='Integrations', exact=True).click()
        page.get_by_role('heading', name='TypeScript and Next.js').wait_for()
        assert '@tracebloom/next' in page.locator('pre').first.inner_text()
        print('PASS renamed SDK integration instructions render')
        if os.environ.get('OML_SMOKE_LANDING_URL'):
            page.goto(os.environ['OML_SMOKE_LANDING_URL'])
            assert page.title() == 'Tracebloom'
            page.get_by_role('link', name='Create your free account', exact=True).wait_for()
            print('PASS Tracebloom marketing renders with working account links')
        assert not failures, 'Browser page errors detected'
        context.close()
    finally:
        browser.close()
