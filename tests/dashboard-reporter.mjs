export default class DashboardReporter {
  pending = Promise.resolve();
  onTestBegin(test) {
    this.send({ test: test.title, status: "running" });
  }
  onTestEnd(test, result) {
    this.send({ test: test.title, status: result.status });
  }
  async onEnd() {
    await this.pending;
  }
  send(event) {
    const url = process.env.TEST_DASHBOARD_EVENTS;
    if (url)
      this.pending = this.pending
        .then(() =>
          fetch(url, {
            method: "POST",
            body: JSON.stringify(event),
            headers: { "content-type": "application/json" },
            signal: AbortSignal.timeout(1000),
          }),
        )
        .then(() => undefined)
        .catch(() => {
          /* Observational reporting cannot fail a test. */
        });
  }
}
