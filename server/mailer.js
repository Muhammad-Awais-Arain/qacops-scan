import nodemailer from "nodemailer";
import { config } from "./config.js";

const smtpConfigured = Boolean(config.smtp.host);

const transport = smtpConfigured
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : nodemailer.createTransport({ jsonTransport: true });

export function mailStatus() {
  return smtpConfigured ? `sending email through ${config.smtp.host}` : "SMTP_HOST not set, emails are printed to the console instead of sent";
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const oneLine = (s, max = 120) => String(s ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);

function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#eef1f6;font-family:Arial,Helvetica,sans-serif;color:#0d1626">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#0d1626;padding:22px 28px;color:#f5b53f;font-size:22px;font-weight:bold">QACops</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.2;color:#0d1626">${esc(title)}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:18px 28px;background:#f6f8fb;color:#5d6a82;font-size:13px">QACops, the QA crew for teams shipping faster than they can test.</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href, label) =>
  `<p style="margin:24px 0"><a href="${esc(href)}" style="display:inline-block;background:#f5b53f;color:#0d1626;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:999px">${esc(label)}</a></p>`;

async function send(message) {
  try {
    const info = await transport.sendMail({ from: config.mailFrom, ...message });
    if (!smtpConfigured) {
      const parsed = JSON.parse(info.message);
      console.log(`[mail preview] to=${parsed.to?.map((t) => t.address).join(", ")} subject="${parsed.subject}"`);
    }
    return true;
  } catch (err) {
    // Email is a nice to have: never let a mail failure break a scan or a form.
    console.error("[mail] failed:", err.message);
    return false;
  }
}

function verdictLine(totals) {
  if (!totals.fail && !totals.warn) return "Clean run. Nothing an automated pass can find is wrong.";
  if (!totals.fail) return `Nothing failing, but ${totals.warn} ${totals.warn > 1 ? "areas need" : "area needs"} a look.`;
  return `${totals.fail} of 7 checks failing${totals.warn ? ` and ${totals.warn} more worth a look` : ""}.`;
}

export function sendReportReady({ to, report }) {
  const link = `${config.publicUrl}/r/${report.id}`;
  const verdict = verdictLine(report.totals);
  const host = oneLine(report.host, 80);
  return send({
    to,
    replyTo: config.ownerEmail,
    subject: `Your QA report for ${host} is ready`,
    text: `Your QACops Scan of ${host} is done.\n\n${verdict}\n\nOpen the report: ${link}\n\nThe link stays live for ${config.reportTtlDays} days and you can share it with your team.\n\nWant this on every release? Reply to this email or visit ${config.auditUrl}\n\nQACops`,
    html: layout(
      `Your QA report for ${host} is ready`,
      `<p style="margin:0 0 12px;font-size:16px;line-height:1.6">We scanned ${report.pages.length} page${report.pages.length === 1 ? "" : "s"} on ${esc(host)}.</p>
<p style="margin:0;font-size:18px;line-height:1.5;font-weight:bold">${esc(verdict)}</p>
${button(link, "Open the report")}
<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3b4760">The link stays live for ${config.reportTtlDays} days, and anyone you share it with can read it.</p>
<p style="margin:0;font-size:14px;line-height:1.6;color:#3b4760">This was one automated run on public pages. If you want it on every release, with a person reading every failure, just reply to this email.</p>`
    ),
  });
}

export function notifyOwnerOfScan({ email, report }) {
  const link = `${config.publicUrl}/r/${report.id}`;
  const host = oneLine(report.host, 80);
  return send({
    to: config.ownerEmail,
    replyTo: email,
    subject: `New scan: ${host} (${report.totals.fail} failing)`,
    text: `${email} scanned ${report.landedUrl}\n\n${verdictLine(report.totals)}\n\nReport: ${link}\n\nReply to this email to reach them directly.`,
  });
}

export function sendContact({ name, company, email, link, pain }) {
  const safe = { name: oneLine(name, 80), company: oneLine(company, 80), email: oneLine(email, 120), link: oneLine(link, 300) };
  const details = [
    ["Name", safe.name],
    ["Company", safe.company],
    ["Email", safe.email],
    ["Repo or product", safe.link || "not given"],
  ];
  const toOwner = send({
    to: config.ownerEmail,
    replyTo: safe.email,
    subject: `Free audit request from ${safe.company}`,
    text: `${details.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nWhat keeps breaking:\n${pain || "not given"}`,
    html: layout(
      `Free audit request from ${safe.company}`,
      `<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.6">${details
        .map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;color:#5d6a82">${k}</td><td>${esc(v)}</td></tr>`)
        .join("")}</table>
<p style="margin:18px 0 6px;color:#5d6a82;font-size:14px">What keeps breaking</p>
<p style="margin:0;font-size:15px;line-height:1.6;white-space:pre-wrap">${esc(pain || "not given")}</p>
<p style="margin:18px 0 0;font-size:14px;color:#5d6a82">Reply to this email to answer them directly.</p>`
    ),
  });
  const toVisitor = send({
    to: safe.email,
    replyTo: config.ownerEmail,
    subject: "We got your QA audit request",
    text: `Hi ${safe.name},\n\nThanks for asking for a free QA audit for ${safe.company}. A person on our team reads every request and we'll reply within one working day.\n\nIf you want to add anything, like access to your repo or your last release notes, just reply to this email.\n\nQACops`,
    html: layout(
      "We got your QA audit request",
      `<p style="margin:0 0 12px;font-size:16px;line-height:1.6">Hi ${esc(safe.name)},</p>
<p style="margin:0 0 12px;font-size:16px;line-height:1.6">Thanks for asking for a free QA audit for ${esc(safe.company)}. A person on our team reads every request and we'll reply within one working day.</p>
<p style="margin:0;font-size:16px;line-height:1.6">If you want to add anything, like access to your repo or your last release notes, just reply to this email.</p>`
    ),
  });
  return Promise.all([toOwner, toVisitor]).then(([owner]) => owner);
}
