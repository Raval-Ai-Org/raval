"use client";
import { serverFn } from "@/lib/rpc-client";
import type * as Slack from "@/server/fns/slack";
export const getSlackConnection = serverFn<typeof Slack.getSlackConnection>(
  "slack/getSlackConnection",
);
export const startSlackConnect =
  serverFn<typeof Slack.startSlackConnect>("slack/startSlackConnect");
export const listSlackChannels =
  serverFn<typeof Slack.listSlackChannels>("slack/listSlackChannels");
export const setSlackChannel = serverFn<typeof Slack.setSlackChannel>("slack/setSlackChannel");
export const setSlackPreferences = serverFn<typeof Slack.setSlackPreferences>(
  "slack/setSlackPreferences",
);
export const createSlackLinkCode = serverFn<typeof Slack.createSlackLinkCode>(
  "slack/createSlackLinkCode",
);
export const sendSlackTest = serverFn<typeof Slack.sendSlackTest>("slack/sendSlackTest");
export const disconnectSlack = serverFn<typeof Slack.disconnectSlack>("slack/disconnectSlack");
