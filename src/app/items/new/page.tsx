import { NewItemForm } from "./NewItemForm";

export default async function NewItemPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const sp = await searchParams;
  // Only allow same-origin paths to prevent open-redirect.
  const returnTo =
    sp.returnTo && sp.returnTo.startsWith("/") ? sp.returnTo : null;
  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <h1 className="text-2xl font-semibold">New item</h1>
      <NewItemForm returnTo={returnTo} />
    </div>
  );
}
