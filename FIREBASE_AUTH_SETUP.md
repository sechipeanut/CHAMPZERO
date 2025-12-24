# Firebase Authentication Configuration Guide

This document explains how to configure Firebase Authentication action URLs for your ChampZero application.

## Overview

The authentication system now supports:
1. **Password Reset** - Users can reset their passwords via email
2. **Email Verification** - New accounts must verify their email before signing in
3. **Email Verification Blocking** - Unverified users cannot sign in

## Firebase Console Configuration

### Setting Up Action URLs

You need to configure Firebase Auth to use your custom action handler page:

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your ChampZero project
3. Navigate to **Authentication** → **Templates**
4. Click on each template type and configure:

#### For Email Verification:
- **Template Type**: Email address verification
- **Action URL**: `https://yourdomain.com/.netlify/functions/action`
- The system will automatically route to `/verify-email.html` with the correct parameters

#### For Password Reset:
- **Template Type**: Password reset
- **Action URL**: `https://yourdomain.com/.netlify/functions/action`
- The system will automatically route to `/reset-password.html` with the correct parameters

### URL Parameters

Firebase automatically appends these parameters to your action URL:
- `mode` - The action type (`resetPassword`, `verifyEmail`, `recoverEmail`)
- `oobCode` - The one-time code for verification/reset
- `continueUrl` - Optional return URL after action completion

Example URL:
```
https://yourdomain.com/.netlify/functions/action?mode=resetPassword&oobCode=ABC123XYZ&continueUrl=https://yourdomain.com/login.html
```

## Files Created/Modified

### New Files:
1. **netlify/functions/action.js** - Serverless function that securely routes Firebase action URLs
2. **reset-password.html** - Password reset page with form
3. **verify-email.html** - Email verification confirmation page
4. **js/reset-password.js** - Password reset logic with oobCode verification
5. **js/verify-email.js** - Email verification logic

### Modified Files:
1. **login.html** - Added "Forgot password?" link
2. **forgot-password.html** - Updated to include action URL configuration
3. **js/auth.js** - Added:
   - Email verification blocking on sign-in
   - Automatic verification email sending on signup
   - Email verification status checking

## User Flow

### Sign Up Flow:
1. User creates account on `/signup.html`
2. System creates Firebase Auth user
3. System sends verification email automatically
4. User is signed out and redirected to login
5. User receives email with verification link
6. User clicks link → routed to `/verify-email.html`
7. Email is verified
8. User can now sign in

### Password Reset Flow:
1. User clicks "Forgot password?" on login page
2. User enters email on `/forgot-password.html`
3. System sends password reset email
4. User receives email with reset link
5. User clicks link → routed to `/reset-password.html`
6. User enters new password
7. System verifies oobCode and updates password
8. User is redirected to login

### Sign In Flow:
1. User enters credentials on `/login.html`
2. System checks if email is verified
3. If not verified: Sign-in blocked, error message shown
4. If verified: User signed in and redirected to profile

## Security Features

✅ **oobCode Verification** - All actions require valid one-time codes from Firebase
✅ **Email Verification Required** - Unverified users cannot sign in
✅ **Expired Link Handling** - Clear error messages for expired/invalid links
✅ **Auto Sign-Out** - Users signed out after signup until verified
✅ **Password Validation** - Minimum 6 characters, matching confirmation

## Testing

### Local Testing (Development):
For local testing with Netlify Dev:
```bash
netlify dev
```

Then use:
- `http://localhost:8888/.netlify/functions/action`

Configure this in Firebase Console templates during development.

### Production Testing:
1. Deploy your site to your production domain
2. Update Firebase action URL to production domain
3. Test the full flow:
   - Sign up a new account
   - Check email for verification
   - Click verification link
   - Try to sign in (should work after verification)
   - Test password reset flow

## Troubleshooting

### Issue: Verification email not arriving
- Check Firebase Console → Authentication → Templates
- Ensure SMTP is configured correctly
- Check spam folder

### Issue: Action URL shows "Invalid link"
- Verify action URL in Firebase Console matches your deployed domain
- Check browser console for JavaScript errors
- Ensure all JS files are loading correctly

### Issue: Users can't sign in after verification
- Reload Firebase Auth user to get updated emailVerified status
- Check browser console for errors
- Verify auth.js is importing sendEmailVerification correctly

## API Endpoints for Firebase

The following endpoints handle Firebase Auth actions:

| Endpoint | Purpose | Parameters |
|----------|---------|------------|
| `/.netlify/functions/action` | Serverless router for all Firebase actions | `mode`, `oobCode`, `continueUrl` |
| `/reset-password.html` | Password reset interface | `mode=resetPassword`, `oobCode` |
| `/verify-email.html` | Email verification handler | `mode=verifyEmail`, `oobCode` |

## Security Features

✅ **Serverless Function** - Action handler runs server-side, not exposed as static HTML
✅ **No Direct Access Risk** - Users accessing the endpoint without params are safely redirected

## Notes

- Google Sign-In users are automatically considered verified (no email verification required)
- The system gracefully handles expired codes with user-friendly error messages
- All authentication state is managed by Firebase Auth
- Email verification status is synced to Firestore on every sign-in
- **You can delete `action.html`** - The Netlify Function replaces it with a more secure server-side solution
