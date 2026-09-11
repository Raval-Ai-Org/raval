"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";
import { FullPage } from "./SharePage";

export default function ShareError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error);
    reportClientError(error);
  }, [error]);
  return <FullPage title="Something went wrong" body="Try refreshing the page." />;
}
