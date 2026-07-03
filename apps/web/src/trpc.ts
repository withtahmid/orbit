import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../server/src/routers/index.mjs";
import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { baseBackendURL } from "./config/urls";

export const trpc = createTRPCReact<AppRouter>();

const getHeaders = () => {
    const token = localStorage.getItem("auth_token");
    if (token) return { Authorization: `Bearer ${token}` };

    // During signup flow, use the signup token
    const signupToken = localStorage.getItem("signup_token");
    if (signupToken) return { Authorization: `Bearer ${signupToken}` };

    // During password reset flow
    const resetToken = localStorage.getItem("password_reset_token");
    if (resetToken) return { Authorization: `Bearer ${resetToken}` };

    return {};
};

export const trpcClient = trpc.createClient({
    links: [
        httpBatchLink({
            url: `${baseBackendURL}/trpc`,
            headers: getHeaders,
            /* Batched queries go out as ONE GET with every input in the URL.
               A post-mutation invalidate() refetches a dozen queries in the
               same tick (analytics + personal namespaces + entity lists, each
               with large filter inputs), and an uncapped batch URL can exceed
               server/proxy limits — failing EVERY refetch in the batch as a
               unit, silently. Splitting oversized batches keeps one huge
               input from taking down unrelated refetches. 2083 = the classic
               lowest-common-denominator URL limit. */
            maxURLLength: 2083,
        }),
    ],
});

export type RouterInput = inferRouterInputs<AppRouter>;
export type RouterOutput = inferRouterOutputs<AppRouter>;
