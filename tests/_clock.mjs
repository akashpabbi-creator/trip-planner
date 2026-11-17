// Tests build trips around fixed dates (2026-11-10 and so on). Start the browser clock just before them (it keeps ticking) so "past/coming" and "today" do not drift with the real date.
export function freezeClock(browser, iso = "2026-11-08T12:00:00") {
  const make = browser.newContext.bind(browser);
  browser.newContext = async (opts) => {
    const c = await make(opts);
    await c.clock.install({ time: new Date(iso) });
    return c;
  };
  return browser;
}
