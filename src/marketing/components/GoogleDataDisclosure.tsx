/** Public explanation of the optional Google data integration. */
export default function GoogleDataDisclosure() {
  return (
    <section
      aria-labelledby="google-marketing-data"
      className="mx-auto w-full max-w-5xl px-5 py-12 sm:px-8"
    >
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-9">
        <h2 id="google-marketing-data" className="text-2xl font-medium text-white">
          Your marketing, informed by your own data.
        </h2>
        <p className="mt-4 leading-relaxed text-white/75">
          Mellox AI brings AI marketing, content creation, analytics, SEO/GEO, scheduling and
          integrations together for businesses and agencies. Connect Google Analytics and Google
          Search Console when you want your website traffic and search performance in your marketing
          dashboard.
        </p>
        <p className="mt-3 leading-relaxed text-white/75">
          With your permission, Mellox reads reports from the property and site you select to show
          visits, engagement, search queries and page performance. Relevant signals and summaries
          are processed by AI to explain changes and suggest next steps for your own marketing.
          Access is read-only, and you can disconnect at any time.
        </p>
        <nav
          aria-label="Data use and AI safety"
          className="mt-5 flex flex-wrap gap-5 text-sm text-lime"
        >
          <a className="underline underline-offset-4" href="/privacy#google-data">
            Privacy Policy and Google data use
          </a>
          <a className="underline underline-offset-4" href="/terms">
            Terms of Service
          </a>
          <a className="underline underline-offset-4" href="/safety">
            AI safety and acceptable use
          </a>
        </nav>
      </div>
    </section>
  );
}
