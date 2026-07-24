import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../logger.js";

const OtpProviderResponseSchema = z.object({
  success: z.boolean(),
});

/** Places a voice call carrying the OTP code via the s.api.ir provider (or logs it under OTP_TEST_MODE). */
export async function sendOtpCall(phoneNumber: string, code: string): Promise<boolean> {
  if (config.otp.testMode) {
    logger.info({ phoneNumber, code }, "OTP_TEST_MODE is on — skipping real voice call");
    return true;
  }

  try {
    const res = await fetch(`${config.otp.baseUrl}/api/sw1/CallOTP`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.otp.bearerToken}`,
      },
      body: JSON.stringify({ code, number: phoneNumber }),
    });

    if (!res.ok) {
      logger.error({ status: res.status }, "OTP provider request failed");
      return false;
    }

    const parsed = OtpProviderResponseSchema.parse(await res.json());
    return parsed.success;
  } catch (error) {
    logger.error({ err: error }, "OTP provider request threw");
    return false;
  }
}
