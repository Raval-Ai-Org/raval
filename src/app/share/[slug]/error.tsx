"use client";

import { useEffect } from "react";
import { FullPage } from "./SharePage";

export default function ShareError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <FullPage title="Something went wrong" body="Try refreshing the page." />;
}
