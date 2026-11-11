import { expect, it } from "vitest";
import client from "./axiosInstance";
it("keeps login and employee bearer requests on the current app origin", () => {
  expect(client.defaults.baseURL).toBe("/api");
  expect(client.defaults.withCredentials).toBe(true);
});
