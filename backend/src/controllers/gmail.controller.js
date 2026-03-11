import { google } from 'googleapis';
import * as gmailSyncService from '../services/gmail.service.js';
import prisma from '../utils/prisma.js';
import { decrypt } from '../utils/encryption.js';

function classifySyncError(err) {
    // googleapis GaxiosError: err.code can be a number or string
    const status = err?.response?.status || Number(err?.code) || 0;
    // googleapis puts errors at err.errors OR err.response.data.error.errors
    const reason =
        err?.errors?.[0]?.reason ||
        err?.response?.data?.error?.errors?.[0]?.reason;

    console.error('[Gmail Sync] Raw error details:', {
        status,
        reason,
        code: err?.code,
        message: err?.message,
        googleMessage: err?.response?.data?.error?.message,
    });

    if (status === 403 && reason === 'accessNotConfigured') {
        return {
            statusCode: 503,
            code: 'GMAIL_API_DISABLED',
            message:
                'Gmail API is not enabled for your Google Cloud project. Go to Google Cloud Console → APIs & Services → Library → search "Gmail API" → click Enable.',
        };
    }

    if (status === 403) {
        return {
            statusCode: 403,
            code: 'GMAIL_FORBIDDEN',
            message: `Gmail API returned 403: ${reason || err?.message || 'Forbidden'}. Check API is enabled and scopes are correct.`,
        };
    }

    if (status === 401 || reason === 'invalidCredentials' || reason === 'authError') {
        return {
            statusCode: 401,
            code: 'GMAIL_TOKEN_INVALID',
            message: 'Gmail authorization is expired or invalid. Please reconnect your Gmail account.',
        };
    }

    return {
        statusCode: 500,
        code: 'GMAIL_SYNC_FAILED',
        message: err?.message || 'Failed to sync Gmail messages',
    };
}

export async function syncGmailMessagesController(req, res) {
    try {
        const messages = await gmailSyncService.syncGmailMessages(req.user.id);
        const newCount = messages.filter((m) => m._isNew).length;
        res.json({
            success: true,
            synced: messages.length,
            newMessages: newCount,
        });
    } catch (err) {
        console.error('Gmail sync error:', err);
        const mapped = classifySyncError(err);

        res.status(mapped.statusCode).json({
            success: false,
            error: {
                code: mapped.code,
                message: mapped.message,
                details: err?.response?.data?.error?.message || err?.message || null,
            },
            messages: [],
        });
    }
}

// Diagnostic endpoint — checks Gmail API connectivity step by step
export async function gmailDiagnosticController(req, res) {
    const checks = [];

    try {
        // 1. Check for connected Gmail accounts
        const accounts = await prisma.connectedAccount.findMany({
            where: { userId: req.user.id, platform: 'gmail', status: 'active' },
            include: { authToken: true },
        });

        checks.push({
            step: 'Connected Gmail accounts',
            ok: accounts.length > 0,
            detail: accounts.length > 0
                ? `Found ${accounts.length} account(s): ${accounts.map((a) => a.platformAccountId).join(', ')}`
                : 'No active Gmail accounts found. Go to Connections page and connect Gmail first.',
        });

        if (accounts.length === 0) {
            return res.json({ success: false, checks });
        }

        const account = accounts[0];

        // 2. Check auth token exists
        checks.push({
            step: 'Auth token stored',
            ok: !!account.authToken,
            detail: account.authToken
                ? `Token exists (updated ${account.authToken.updatedAt})`
                : 'No auth token found for this account. Reconnect Gmail.',
        });

        if (!account.authToken) {
            return res.json({ success: false, checks });
        }

        // 3. Decrypt token
        let accessToken;
        let refreshToken;
        try {
            accessToken = decrypt(account.authToken.accessTokenEncrypted);
            refreshToken = account.authToken.refreshTokenEncrypted
                ? decrypt(account.authToken.refreshTokenEncrypted)
                : null;
            checks.push({
                step: 'Token decryption',
                ok: true,
                detail: `Access token: ${accessToken.slice(0, 10)}... | Refresh token: ${refreshToken ? 'present' : 'missing'}`,
            });
        } catch (decryptErr) {
            checks.push({
                step: 'Token decryption',
                ok: false,
                detail: `Decryption failed: ${decryptErr.message}. ENCRYPTION_KEY may have changed since the token was stored.`,
            });
            return res.json({ success: false, checks });
        }

        // 4. Test Gmail API call
        const client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );
        client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

        const gmail = google.gmail({ version: 'v1', auth: client });
        const listRes = await gmail.users.messages.list({
            userId: 'me',
            maxResults: 1,
        });

        checks.push({
            step: 'Gmail API call',
            ok: true,
            detail: `Gmail API is working. Found ${listRes.data.resultSizeEstimate || 0} messages.`,
        });

        res.json({ success: true, checks });
    } catch (err) {
        const status = err?.response?.status || Number(err?.code) || 0;
        const reason =
            err?.errors?.[0]?.reason ||
            err?.response?.data?.error?.errors?.[0]?.reason;
        const googleMsg = err?.response?.data?.error?.message || err?.message;

        checks.push({
            step: 'Gmail API call',
            ok: false,
            detail: `FAILED — HTTP ${status}, reason: ${reason || 'unknown'}, message: ${googleMsg}`,
        });

        res.json({ success: false, checks });
    }
}
