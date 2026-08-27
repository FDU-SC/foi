export const problemViewModules = import.meta.glob("./problems/*/views.tsx", {
  eager: true,
});

export const problemViewDefaultModules = import.meta.glob(
  "./problems/views.ts",
  { eager: true },
);
