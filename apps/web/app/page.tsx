import { StatusScreen } from "../components/status-screen";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function HomePage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  return <StatusScreen searchParams={searchParams} />;
}
