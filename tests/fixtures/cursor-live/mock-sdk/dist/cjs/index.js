const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const replies = JSON.parse(readFileSync(join(process.env.LIVE_CWD, "mock-replies.json"), "utf8"));
let turn = 0;
const agent = {
  agentId: "mock-agent",
  async send() {
    const result = replies[turn++];
    return { wait: async () => ({ result }) };
  },
};

exports.Agent = {
  create: async () => agent,
  resume: async () => agent,
};
