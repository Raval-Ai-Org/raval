"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Settings2, Link, RefreshCw } from "@/components/icons";

const LONG_NAME = "Northwind International Marketing and Customer Communications";

/** Shared controls under the long-name and narrow-panel conditions seen across the app. */
export function ControlStressLab() {
  const [selected, setSelected] = useState("brand");
  return (
    <TooltipProvider>
      <div
        data-testid="control-stress"
        className="ds-tile mx-auto w-[340px] max-w-full space-y-5 p-4"
      >
        <h1 className="ds-page-title">Workspace controls</h1>
        <div className="flex min-w-0 items-center gap-2">
          <Input aria-label="Workspace search" placeholder="Find a workspace" />
          <Button size="icon" aria-label="Refresh workspaces">
            <RefreshCw />
          </Button>
        </div>
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger aria-label="Connected workspace">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="brand">{LONG_NAME}</SelectItem>
            <SelectItem value="long-url">
              https://northwind.example/international/marketing/connections
            </SelectItem>
          </SelectContent>
        </Select>
        <Tabs defaultValue="one">
          <TabsList>
            <TabsTrigger value="one">Overview</TabsTrigger>
            <TabsTrigger value="two">Scheduled content</TabsTrigger>
            <TabsTrigger value="three">Connections</TabsTrigger>
          </TabsList>
          <TabsContent value="one">All your workspace updates appear here.</TabsContent>
          <TabsContent value="two">Nothing is scheduled yet.</TabsContent>
          <TabsContent value="three">Connect your accounts to get started.</TabsContent>
        </Tabs>
        <Button className="w-full">
          Try loading all of your website connections and social accounts again
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">Workspace actions</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-96" align="end">
            <DropdownMenuItem>
              <Settings2 /> Settings for {LONG_NAME}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Connected social accounts</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="w-96">
                  {Array.from({ length: 12 }, (_, i) => (
                    <DropdownMenuItem key={i}>Northwind regional account {i + 1}</DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" aria-label="Connection details">
              <Link /> Connection details
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            https://northwind.example/international/marketing/a-very-long-connected-workspace-address
          </TooltipContent>
        </Tooltip>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline">Review connection change</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect {LONG_NAME}?</AlertDialogTitle>
              <AlertDialogDescription>
                Review the affected channels before continuing. Posts already published will stay on
                your channels. Drafts will stay in your workspace, and you can reconnect the account
                later. https://northwind.example/international/marketing/customer-communications
              </AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="space-y-2 text-sm">
              {Array.from({ length: 6 }, (_, i) => (
                <li key={i}>
                  Regional account {i + 1}: scheduled content will need a new destination.
                </li>
              ))}
            </ul>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep connection</AlertDialogCancel>
              <AlertDialogAction>Confirm change</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
