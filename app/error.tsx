"use client";

import { AppErrorView, type AppErrorProps } from "@/views/error";

export default function AppError(props: AppErrorProps) {
  return <AppErrorView {...props} />;
}
