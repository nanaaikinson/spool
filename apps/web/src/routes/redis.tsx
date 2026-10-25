import { createFileRoute } from "@tanstack/react-router";
import { RedisPage } from "../features/redis";
export const Route = createFileRoute("/redis")({ component: RedisPage });
