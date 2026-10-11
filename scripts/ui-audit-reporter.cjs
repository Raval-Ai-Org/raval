class UiAuditReporter {
  onTestEnd(test, result) {
    if (result.status !== "passed" && result.status !== "skipped") {
      console.log(`\n${test.title}: ${result.errors.map((error) => error.message).join("\n")}\n`);
    }
  }
}
module.exports = UiAuditReporter;
