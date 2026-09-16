"use client";

import { AppErrorView, type AppErrorProps } from "@/views/error";

export default function Error(props: AppErrorProps) {
  return <AppErrorView {...props} />;
}
