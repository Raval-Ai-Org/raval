"use client";
// Query keys and mutations for the brand's product catalogue. Every key
// carries the workspace id, so one brand's products never render under another.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import {
  addProduct,
  discoverProducts,
  listProducts,
  updateProduct,
} from "@/lib/products.functions";
import type { CatalogProduct } from "@/lib/products/catalog";

export const productKeys = {
  all: (ws: string | null) => ["products", ws] as const,
  list: (ws: string | null) => ["products", ws, "list"] as const,
};

const message = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export function useProducts(workspaceId: string | null) {
  return useQuery({
    queryKey: productKeys.list(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    queryFn: async () =>
      (await listProducts({ data: { workspaceId: workspaceId as string } })).products,
  });
}

function useSetList(workspaceId: string | null) {
  const client = useQueryClient();
  return (products: CatalogProduct[]) =>
    client.setQueryData(productKeys.list(workspaceId), products);
}

export function useDiscoverProducts(workspaceId: string | null) {
  const setList = useSetList(workspaceId);
  return useMutation({
    mutationFn: (websiteUrl: string) =>
      discoverProducts({ data: { workspaceId: workspaceId as string, websiteUrl } }),
    onSuccess: (result) => {
      setList(result.products);
      if (result.added)
        toast.success(`Found ${result.added} product${result.added === 1 ? "" : "s"}`);
      else if (!result.found)
        toast.info("No products found on the website", {
          description: "Add a product from its page link instead.",
        });
      else toast.info("Your catalogue is up to date");
    },
    onError: (error) =>
      toast.error("Couldn't read the website", { description: message(error, "Try again later") }),
  });
}

export function useAddProduct(workspaceId: string | null) {
  const setList = useSetList(workspaceId);
  return useMutation({
    mutationFn: (url: string) => addProduct({ data: { workspaceId: workspaceId as string, url } }),
    onSuccess: (result) => {
      setList(result.products);
      toast.success("Product added");
    },
    onError: (error) =>
      toast.error("Couldn't add that product", { description: message(error, "Try again later") }),
  });
}

export function useUpdateProduct(workspaceId: string | null) {
  const setList = useSetList(workspaceId);
  return useMutation({
    mutationFn: (patch: {
      id: string;
      status?: "active" | "removed";
      primary?: true;
      name?: string;
    }) => updateProduct({ data: { workspaceId: workspaceId as string, ...patch } }),
    onSuccess: (result) => setList(result.products),
    onError: (error) =>
      toast.error("Couldn't change the product", {
        description: message(error, "Try again later"),
      }),
  });
}
