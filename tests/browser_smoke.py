"""Run with the local server on port 8080; requires Python Playwright + Chromium.

Example: npm run dev, then python tests/browser_smoke.py
Screenshots/reports are written to the ignored output/playwright directory.
"""
import csv
import io
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, expect


OUTPUT = Path(__file__).resolve().parents[1] / 'output' / 'playwright'
OUTPUT.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('CLOUD_COMPARE_URL', 'http://127.0.0.1:8080')


def compare(page):
    page.locator('#compare-button').click()
    expect(page.locator('#edited-notice')).to_be_hidden()


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1050}, accept_downloads=True)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE)
    page.wait_for_load_state('networkidle')
    expect(page.locator('#result-content')).to_be_visible()
    expect(page.locator('#comparison-table-body tr')).to_have_count(5)
    expect(page.locator('#coverage-list .provider-card')).to_have_count(3)
    expect(page.locator('#comparison-summary')).to_contain_text('5 complete')
    expect(page.locator('#best-provider')).to_have_text('AWS')
    expect(page.locator('#general-options')).not_to_have_attribute('open', '')
    expect(page.locator('#resource-options')).not_to_have_attribute('open', '')
    page.screenshot(path=str(OUTPUT / 'desktop-general.png'), full_page=True)
    page.locator('#toggle-scenarios').click()
    page.locator('#general-options').evaluate('(el) => el.open = true')

    # Both machine-readable reports preserve the catalog version and quote completeness.
    with page.expect_download() as download:
        page.locator('#export-json').click()
    report = json.loads(Path(download.value.path()).read_text(encoding='utf-8'))
    assert report['snapshotId'] and len(report['quotes']) == 8
    assert sum(q['status'] == 'complete' for q in report['quotes']) == 5
    assert all(q['total'] is None for q in report['quotes'] if q['status'] != 'complete')
    with page.expect_download() as download:
        page.locator('#export-csv').click()
    rows = list(csv.reader(io.StringIO(Path(download.value.path()).read_text(encoding='utf-8-sig'))))
    assert len(rows) == 9 and 'snapshot_id' in rows[0]

    # Saving names as text must never insert executable markup into the page.
    scenario_name = 'API baseline <img src=x onerror=alert(1)>'
    page.locator('#scenario-name').fill(scenario_name)
    page.locator('#save-scenario').click()
    expect(page.locator('#saved-scenarios')).to_contain_text(scenario_name)
    assert page.locator('#saved-scenarios img').count() == 0
    page.locator('#active').fill('10001')
    expect(page.locator('#edited-notice')).to_be_visible()
    expect(page.locator('#recommendation-card')).to_have_class('recommendation-card stale')
    page.locator('#revert-inputs').click()
    expect(page.locator('#active')).to_have_value('2000')
    expect(page.locator('#edited-notice')).to_be_hidden()
    page.locator('#active').fill('10001')
    page.locator('#compare-button').click()
    expect(page.locator('#active-error')).to_contain_text('cannot exceed')
    assert page.locator('#active').evaluate('(el) => el === document.activeElement')
    page.get_by_role('button', name='Load scenario ' + scenario_name, exact=True).click()
    expect(page.locator('#active')).to_have_value('2000')
    expect(page.locator('#edited-notice')).to_be_hidden()

    page.locator('#geography').select_option('india')
    compare(page)
    expect(page.locator('#comparison-summary')).to_contain_text('4 complete')
    expect(page.locator('#coverage-list')).to_contain_text('Hetzner')
    expect(page.locator('#coverage-list')).to_contain_text('Outside current catalog')
    expect(page.locator('#coverage-list')).to_contain_text('outside India')

    # User-supplied INR conversion is reflected in visible calculations.
    page.locator('.advanced-options').evaluate('(el) => el.open = true')
    page.locator('#fxRate').fill('100')
    page.locator('#currency').select_option('INR')
    expect(page.locator('#edited-notice')).to_be_visible()
    page.locator('#update-estimate').click()
    expect(page.locator('#best-cost')).to_contain_text('2,354')
    expect(page.locator('#pricing-evidence')).to_contain_text('Manual display conversion')
    page.get_by_role('button', name='Load scenario ' + scenario_name, exact=True).click()

    # Main GPU flow has at least one complete sourced estimate, and reference quotes stay partial.
    page.locator('label:has(input[name="mode"][value="gpu"])').click()
    compare(page)
    expect(page.locator('#gpu-fields')).to_be_visible()
    expect(page.locator('#gpuModel')).to_have_value('A100 PCIe')
    expect(page.locator('#best-provider')).to_have_text('Microsoft Azure')
    expect(page.locator('#best-period')).to_contain_text('jobs')
    expect(page.locator('#comparison-summary')).to_contain_text('partial')
    page.screenshot(path=str(OUTPUT / 'desktop-gpu.png'), full_page=True)
    page.locator('#gpuModel').select_option('H100')
    compare(page)
    expect(page.locator('#best-provider')).to_have_text('Review the coverage gaps')
    expect(page.locator('#comparison-summary')).not_to_contain_text('0 partial')
    expect(page.locator('#coverage-list')).to_contain_text('regional')
    page.locator('#preset').select_option('training')
    compare(page)
    expect(page.locator('#coverage-list')).to_contain_text('known charges')

    # Each mode keeps its own edits, while location and currency remain shared.
    page.locator('#gpuHours').fill('17')
    page.locator('#geography').select_option('india')
    page.locator('label:has(input[name="mode"][value="general"])').click()
    expect(page.locator('#geography')).to_have_value('india')
    page.locator('label:has(input[name="mode"][value="gpu"])').click()
    expect(page.locator('#gpuHours')).to_have_value('17')

    # Empty provider selection produces a useful validation error.
    page.locator('#provider-options').evaluate('(el) => el.open = true')
    for checkbox in page.locator('input[name="providers"]').all():
        checkbox.uncheck()
    page.locator('#compare-button').click()
    expect(page.locator('#providers-error')).to_contain_text('at least one provider')
    page.get_by_role('button', name='Load scenario ' + scenario_name, exact=True).click()
    page.locator('#scenario-name').fill('Updated API scenario')
    page.locator('#save-scenario').click()
    expect(page.locator('.saved-scenario')).to_have_count(1)
    page.locator('#scenario-name').fill(scenario_name)
    page.locator('#save-scenario').click()
    page.locator('#scenario-name').fill('API copy')
    page.locator('#save-as-scenario').click()
    expect(page.locator('.saved-scenario')).to_have_count(2)
    page.get_by_role('button', name='Delete scenario ' + scenario_name, exact=True).click()
    expect(page.locator('#saved-scenarios')).not_to_contain_text(scenario_name)
    page.locator('#undo-delete').click()
    expect(page.locator('#saved-scenarios')).to_contain_text(scenario_name)

    # Printing expands calculations then restores each details element's previous state.
    page.locator('#quote-detail details').first.evaluate('(el) => el.open = false')
    page.evaluate("window.dispatchEvent(new Event('beforeprint'))")
    assert page.locator('#quote-detail details:not([open])').count() == 0
    page.emulate_media(media='print')
    page.pdf(path=str(OUTPUT / 'comparison-report.pdf'), print_background=True)
    page.emulate_media(media='screen')
    page.evaluate("window.dispatchEvent(new Event('afterprint'))")
    assert page.locator('#quote-detail details').first.evaluate('(el) => el.open') is False

    # Mobile layout must remain within the viewport, including long configuration/source text.
    page.set_viewport_size({'width': 390, 'height': 844})
    page.goto(BASE)
    page.wait_for_load_state('networkidle')
    expect(page.locator('#result-content')).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.locator('#resource-options').scroll_into_view_if_needed()
    assert page.locator('#compare-button').evaluate('(el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1; }')
    page.screenshot(path=str(OUTPUT / 'mobile-general.png'), full_page=True)
    page.locator('label:has(input[name="mode"][value="gpu"])').click()
    compare(page)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.locator('#comparison-list .detail-button').first.click()
    expect(page.locator('#comparison-list #quote-detail')).to_be_visible()
    page.screenshot(path=str(OUTPUT / 'mobile-gpu.png'), full_page=True)
    page.set_viewport_size({'width': 320, 'height': 700})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert not errors, errors

    # A failed catalog download must not produce a stale or zero-cost recommendation.
    failure = context.new_page()
    failure.route('**/data/catalog.json', lambda route: route.fulfill(status=503, body='Unavailable'))
    failure.goto(BASE)
    failure.wait_for_load_state('networkidle')
    expect(failure.locator('#retry')).to_be_visible()
    expect(failure.locator('#compare-button')).to_be_disabled()
    expect(failure.locator('#result-content')).to_be_hidden()
    failure.unroute('**/data/catalog.json')
    failure.locator('#retry').click()
    expect(failure.locator('#result-content')).to_be_visible()
    browser.close()
    print('Browser smoke passed: general/GPU, validation, region/currency, save/load/delete, exports, print, mobile, failure/retry.')
