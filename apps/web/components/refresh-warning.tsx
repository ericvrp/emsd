export function RefreshWarning({ message }: { message: string }) {
  return (
    <p className="mt-4 rounded-[1.25rem] border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
      {message}
    </p>
  );
}
