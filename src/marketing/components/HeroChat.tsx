"use client";

import { useState } from "react";
import { APP_URL, appUrlFor } from "@/marketing/lib/app-url";

export default function HeroChat() {
  const [url, setUrl] = useState("");

  return (
    <form
      // Without JavaScript the form still lands on sign-up with the website.
      action={APP_URL}
      method="get"
      onSubmit={(e) => {
        e.preventDefault();
        window.location.assign(appUrlFor(url));
      }}
      className="hero-chat group relative w-[min(560px,calc(100vw-2.5rem))] rounded-full p-[1px]"
    >
      <div className="relative flex items-center gap-2 rounded-full bg-[#0b0d0e]/90 py-1.5 pl-5 pr-1.5 backdrop-blur-xl">
        <svg className="shrink-0 text-white/35 transition-colors group-focus-within:text-lime" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
        </svg>
        <input
          type="text"
          name="url"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Enter your website"
          aria-label="Enter your website"
          className="min-w-0 flex-1 bg-transparent py-2.5 pl-1 text-[16px] font-medium text-white placeholder:text-white/35 focus:outline-none sm:text-[17px]"
        />
        <button
          type="submit"
          aria-label="Continue to Mellox"
          className="hero-chat-go flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-lime text-black transition-all duration-200 hover:scale-105 hover:shadow-[0_0_24px_rgba(203,233,96,0.55)]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </button>
      </div>
    </form>
  );
}
