<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useApi } from '../composables/useApi'

const route = useRoute()
const api = useApi()

const loading = ref(true)
const valid = ref(false)
const provider = ref('')
const token = ref('')
const error = ref('')
const saving = ref(false)
const saved = ref(false)

// Wizard guided step state (starts at step 1 of the provider flow)
const guidedStep = ref(1)

// Form data
const wizardCert = ref('')
const wizardSsoUrl = ref('')
const wizardIssuerUrl = ref('')
const wizardClientId = ref('')
const wizardClientSecret = ref('')
const wizardOidcScopes = ref('openid profile email groups')
const wizardGroupsClaim = ref('groups')
const wizardEmailClaim = ref('email')
const wizardFirstNameClaim = ref('first_name')
const wizardLastNameClaim = ref('last_name')
const wizardProviderName = ref('')

// ── Validation helpers ──
function isValidHttpsUrl(url: string): boolean {
  try { const u = new URL(url); return u.protocol === 'https:' } catch { return false }
}
function isValidCert(cert: string): boolean {
  const trimmed = cert.trim()
  if (trimmed.includes('BEGIN CERTIFICATE')) return true
  return /^[A-Za-z0-9+/=\s]{100,}$/.test(trimmed)
}

const touched = ref<Record<string, boolean>>({})
function touchField(field: string) { touched.value[field] = true }

const fieldErrors = computed(() => {
  const p = provider.value
  const protocol = protocolForProvider(p)
  const errors: Record<string, string> = {}

  if (!wizardProviderName.value.trim()) errors.providerName = 'Provider name is required'
  if (!wizardGroupsClaim.value.trim()) errors.groupsClaim = 'Groups claim is required'
  if (!wizardEmailClaim.value.trim()) errors.emailClaim = 'Email claim is required'

  if (protocol === 'oidc') {
    if (!wizardIssuerUrl.value.trim()) errors.issuerUrl = 'Issuer URL is required'
    else if (!isValidHttpsUrl(wizardIssuerUrl.value.trim())) errors.issuerUrl = 'Issuer URL must start with https://'
    if (!wizardClientId.value.trim()) errors.clientId = 'Client ID is required'
    if (!wizardClientSecret.value.trim()) errors.clientSecret = 'Client Secret is required'
  }

  if (protocol === 'saml') {
    if (!wizardSsoUrl.value.trim()) errors.ssoUrl = 'IdP SSO URL is required'
    else if (!isValidHttpsUrl(wizardSsoUrl.value.trim())) errors.ssoUrl = 'IdP SSO URL must start with https://'
    if (!wizardCert.value.trim()) errors.cert = 'IdP Certificate is required'
    else if (!isValidCert(wizardCert.value)) errors.cert = 'Certificate must be in PEM format (-----BEGIN CERTIFICATE-----...-----END CERTIFICATE-----) or raw base64'
  }

  return errors
})

const stepValid = computed(() => {
  const p = provider.value
  const step = guidedStep.value
  const e = fieldErrors.value

  if (p === 'google') {
    if (step === 1) return true
    if (step === 2) return !e.ssoUrl && !e.cert
    if (step === 3) return true
    if (step === 4) return true
    if (step === 5) return !e.ssoUrl && !e.cert && !e.emailClaim
  }
  if (p === 'okta') {
    if (step <= 2) return true // create app + configure SAML (one Okta page)
    if (step === 3) return !e.ssoUrl && !e.cert // enter IdP details
    if (step === 4) return !e.ssoUrl && !e.cert // review (email/name come from NameID)
  }
  if (p === 'azure') {
    if (step <= 2) return true
    if (step === 3) return true
    if (step === 4) return !e.ssoUrl && !e.cert
    if (step === 5) return !e.ssoUrl && !e.cert && !e.emailClaim
  }
  if (p === 'custom-oidc') {
    if (step === 1) return !e.providerName && !e.issuerUrl && !e.clientId && !e.clientSecret
    if (step === 2) return !e.groupsClaim && !e.emailClaim
    if (step === 3) return !e.providerName && !e.issuerUrl && !e.clientId && !e.clientSecret && !e.groupsClaim && !e.emailClaim
  }
  if (p === 'custom-saml') {
    if (step === 1) return true
    if (step === 2) return !e.ssoUrl && !e.cert
    if (step === 3) return !e.ssoUrl && !e.cert && !e.emailClaim
  }
  return true
})

const hostname = computed(() => typeof window !== 'undefined' ? window.location.origin : '')

function copyText(text: string) {
  navigator.clipboard.writeText(text).catch(() => { /* fallback */ })
}

const totalSteps = computed(() => {
  const p = provider.value
  if (p === 'google') return 5
  if (p === 'okta') return 4
  if (p === 'azure') return 5
  if (p === 'custom-oidc') return 3
  if (p === 'custom-saml') return 3
  return 0
})

const providerLabel = computed(() => {
  const labels: Record<string, string> = {
    'google': 'Google Workspace',
    'okta': 'Okta',
    'azure': 'Azure AD',
    'custom-oidc': 'Custom OIDC',
    'custom-saml': 'Custom SAML',
  }
  return labels[provider.value] || provider.value
})

function protocolForProvider(p: string): string {
  if (p === 'custom-oidc') return 'oidc'
  return 'saml'
}

onMounted(async () => {
  token.value = (route.query.token as string) || ''
  if (!token.value) {
    error.value = 'No setup token provided.'
    loading.value = false
    return
  }
  try {
    const result = await api.validateSetupToken(token.value)
    valid.value = result.valid
    provider.value = result.provider
    wizardProviderName.value = providerLabel.value
  } catch (e: any) {
    error.value = e.message || 'Failed to validate setup token.'
  }
  loading.value = false
})

function stepBack() {
  if (guidedStep.value > 1) guidedStep.value--
}

function stepNext() {
  if (guidedStep.value < totalSteps.value) guidedStep.value++
}

async function saveSetup() {
  saving.value = true
  try {
    const protocol = protocolForProvider(provider.value)
    const data: Record<string, unknown> = {
      name: wizardProviderName.value || providerLabel.value,
      protocol,
      enabled: true,
      jit_provisioning: true,
      groups_claim: wizardGroupsClaim.value || 'groups',
      email_claim: wizardEmailClaim.value || 'email',
      first_name_claim: wizardFirstNameClaim.value || 'first_name',
      last_name_claim: wizardLastNameClaim.value || 'last_name',
      default_group_id: '',
    }
    if (protocol === 'oidc') {
      data.issuer_url = wizardIssuerUrl.value
      data.client_id = wizardClientId.value
      data.client_secret = wizardClientSecret.value
      data.oidc_scopes = wizardOidcScopes.value
    } else {
      data.saml_idp_sso_url = wizardSsoUrl.value
      data.saml_idp_cert = wizardCert.value
      data.saml_sp_entity_id = hostname.value
    }
    await api.saveSsoProvider(data as any)
    await api.completeSetupToken(token.value)
    saved.value = true
  } catch (e: any) {
    alert('Failed to save SSO config: ' + (e.message || e))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="sso-setup-page">
    <div class="sso-setup-card">
      <!-- Header -->
      <div class="sso-setup-header">
        <img src="/logo-mark.svg" alt="Rush" class="login-logo" />
        <h1 class="login-title">Rush <span class="login-title-dim">Observability</span></h1>
      </div>

      <!-- Loading -->
      <div v-if="loading" style="padding: var(--sp-6); text-align: center;">
        <div class="login-spinner" style="margin: 0 auto;"></div>
        <div style="margin-top: var(--sp-3); font-size: 12px; color: var(--text-muted);">Validating setup link...</div>
      </div>

      <!-- Error / expired -->
      <div v-else-if="!valid || error" class="sso-setup-error">
        <div class="sso-setup-error-title">Setup link is invalid</div>
        <div class="sso-setup-error-desc">
          {{ error || 'This setup link has expired or already been used. Ask your admin to generate a new one.' }}
        </div>
      </div>

      <!-- Success state after saving -->
      <div v-else-if="saved" style="text-align: center; padding: var(--sp-6);">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" stroke-width="1.5" stroke-linecap="round" style="margin-bottom: var(--sp-3);">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <div style="font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: var(--sp-2);">SSO configured successfully</div>
        <div style="font-size: 12px; color: var(--text-secondary);">You can close this page. Your admin will see the updated SSO configuration in Settings.</div>
      </div>

      <!-- Wizard guided steps -->
      <template v-else>
        <!-- Step indicator -->
        <div class="wizard-step-indicator">
          <template v-for="s in totalSteps" :key="s">
            <div :class="['wizard-dot', { 'wizard-dot-active': guidedStep >= s, 'wizard-dot-current': guidedStep === s }]"></div>
            <div v-if="s < totalSteps" :class="['wizard-line', { 'wizard-line-active': guidedStep > s }]"></div>
          </template>
        </div>

        <div class="wizard-step-label">{{ providerLabel }} Setup &mdash; Step {{ guidedStep }} of {{ totalSteps }}</div>

        <!-- ═══ Google Workspace SAML ═══ -->
        <template v-if="provider === 'google'">
          <div v-if="guidedStep === 1" class="wizard-step-content">
            <div class="wizard-title">Create the SAML app in Google</div>
            <div class="wizard-instruction">
              Go to <strong>admin.google.com</strong> &rarr; Apps &rarr; Web and mobile apps &rarr; Add app &rarr; <strong>Add custom SAML app</strong>.
            </div>
            <div class="wizard-instruction">Enter the app name:</div>
            <div class="wizard-copyable-box"><code>Rush Observability</code></div>
          </div>

          <div v-if="guidedStep === 2" class="wizard-step-content">
            <div class="wizard-title">Enter your IdP details</div>
            <div class="wizard-instruction">In Google admin, download the certificate and copy the SSO URL:</div>
            <div class="form-group-inline">
              <label class="form-label">IdP Certificate</label>
              <textarea v-model="wizardCert" :class="['form-input', 'mono', { 'input-error': touched.cert && fieldErrors.cert }]" rows="4" placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----" style="font-size: 11px; resize: vertical;" @blur="touchField('cert')"></textarea>
              <div v-if="touched.cert && fieldErrors.cert" class="field-error">{{ fieldErrors.cert }}</div>
            </div>
            <div class="form-group-inline">
              <label class="form-label">SSO URL</label>
              <input v-model="wizardSsoUrl" :class="['form-input', 'mono', { 'input-error': touched.ssoUrl && fieldErrors.ssoUrl }]" placeholder="https://accounts.google.com/o/saml2/idp?idpid=..." @blur="touchField('ssoUrl')" />
              <div v-if="touched.ssoUrl && fieldErrors.ssoUrl" class="field-error">{{ fieldErrors.ssoUrl }}</div>
            </div>
          </div>

          <div v-if="guidedStep === 3" class="wizard-step-content">
            <div class="wizard-title">Copy these values into Google admin</div>
            <div class="form-group-inline">
              <label class="form-label">ACS URL</label>
              <div class="wizard-copyable-box">
                <code>{{ hostname }}/auth/sso/acs</code>
                <button class="btn-copy btn-copy-sm" @click="copyText(hostname + '/auth/sso/acs')">Copy</button>
              </div>
            </div>
            <div class="form-group-inline">
              <label class="form-label">Entity ID</label>
              <div class="wizard-copyable-box">
                <code>{{ hostname }}</code>
                <button class="btn-copy btn-copy-sm" @click="copyText(hostname)">Copy</button>
              </div>
            </div>
            <div class="wizard-instruction">Set Name ID format to <strong>Email</strong>.</div>
          </div>

          <div v-if="guidedStep === 4" class="wizard-step-content">
            <div class="wizard-title">Configure attributes and claim mapping</div>
            <div class="wizard-instruction">In Google admin under <strong>Attributes</strong>, map your Google Directory fields to these App attribute names:</div>
            <div class="form-group-inline">
              <label class="form-label">Email Claim</label>
              <input v-model="wizardEmailClaim" :class="['form-input', 'mono', { 'input-error': touched.emailClaim && fieldErrors.emailClaim }]" placeholder="email" @blur="touchField('emailClaim')" />
              <div v-if="touched.emailClaim && fieldErrors.emailClaim" class="field-error">{{ fieldErrors.emailClaim }}</div>
              <div class="field-hint">Map <strong>Primary email</strong> → this App attribute name (required)</div>
            </div>
            <div class="form-group-inline">
              <label class="form-label">First Name Claim</label>
              <input v-model="wizardFirstNameClaim" class="form-input mono" placeholder="first_name" />
              <div class="field-hint">Map <strong>First name</strong> → this App attribute name (optional)</div>
            </div>
            <div class="form-group-inline">
              <label class="form-label">Last Name Claim</label>
              <input v-model="wizardLastNameClaim" class="form-input mono" placeholder="last_name" />
              <div class="field-hint">Map <strong>Last name</strong> → this App attribute name (optional)</div>
            </div>
            <div class="wizard-instruction" style="margin-top: var(--sp-3);">Then open the <strong>Group membership</strong> section (separate from Attributes), select the Google Groups to include, and set the <strong>App attribute</strong> name to:</div>
            <div class="wizard-copyable-box"><code>groups</code></div>
            <div class="wizard-note">
              <strong>Note:</strong> Each Google group you send only grants access if a group with the <em>same name</em> exists in Rush. Create the matching group under <strong>Settings &rarr; Groups</strong> first, otherwise members sign in with no permissions.
            </div>
            <div class="wizard-instruction" style="margin-top: var(--sp-3);">Finally, open the app's <strong>User access</strong> section. A new app defaults to <strong>OFF for everyone</strong> &mdash; turn it <strong>ON for everyone</strong> (or for the chosen org units/groups) so users can sign in.</div>
          </div>

          <div v-if="guidedStep === 5" class="wizard-step-content">
            <div class="wizard-title">Review and save</div>
            <div class="wizard-review-summary">
              <div class="wizard-review-row"><span class="wizard-review-label">Provider</span><span>Google Workspace (SAML)</span></div>
              <div class="wizard-review-row"><span class="wizard-review-label">ACS URL</span><code class="mono">{{ hostname }}/auth/sso/acs</code></div>
              <div class="wizard-review-row"><span class="wizard-review-label">Entity ID</span><code class="mono">{{ hostname }}</code></div>
              <div class="wizard-review-row"><span class="wizard-review-label">SSO URL</span><span :class="fieldErrors.ssoUrl ? 'review-invalid' : 'review-valid'">{{ fieldErrors.ssoUrl ? '!' : '' }}</span><code class="mono" style="word-break: break-all;">{{ wizardSsoUrl || '(not set)' }}</code></div>
              <div class="wizard-review-row"><span class="wizard-review-label">Certificate</span><span :class="fieldErrors.cert ? 'review-invalid' : 'review-valid'">{{ fieldErrors.cert ? '!' : '' }}</span><span>{{ wizardCert ? 'Provided' : 'Not set' }}</span></div>
              <div class="wizard-review-row"><span class="wizard-review-label">Email Claim</span><code class="mono">{{ wizardEmailClaim }}</code></div>
              <div class="wizard-review-row"><span class="wizard-review-label">First Name</span><code class="mono">{{ wizardFirstNameClaim }}</code></div>
              <div class="wizard-review-row"><span class="wizard-review-label">Last Name</span><code class="mono">{{ wizardLastNameClaim }}</code></div>
            </div>
          </div>
        </template>

        <!-- ═══ Okta SAML ═══ -->
        <template v-if="provider === 'okta'">
          <div v-if="guidedStep === 1" class="wizard-step-content">
            <div class="wizard-title">Create the SAML app in Okta</div>
            <div class="wizard-instruction">In Okta Admin, go to <strong>Applications</strong> &rarr; <strong>Create App Integration</strong> &rarr; <strong>SAML 2.0</strong>.</div>
            <div class="wizard-instruction">On the <strong>General Settings</strong> step, enter the app name:</div>
            <div class="wizard-copyable-box"><code>Rush Observability</code></div>
          </div>

          <div v-if="guidedStep === 2" class="wizard-step-content">
            <div class="wizard-title">Configure SAML in Okta</div>
            <div class="wizard-instruction">On Okta's <strong>Configure SAML</strong> step, set:</div>
            <div class="form-group-inline">
              <label class="form-label">Single sign-on URL</label>
              <div class="wizard-copyable-box">
                <code>{{ hostname }}/auth/sso/acs</code>
                <button class="btn-copy btn-copy-sm" @click="copyText(hostname + '/auth/sso/acs')">Copy</button>
              </div>
            </div>
            <div class="form-group-inline">
              <label class="form-label">Audience URI (SP Entity ID)</label>
              <div class="wizard-copyable-box">
                <code>{{ hostname }}</code>
                <button class="btn-copy btn-copy-sm" @click="copyText(hostname)">Copy</button>
              </div>
            </div>
            <div class="wizard-instruction" style="margin-top: var(--sp-3);">Set <strong>Name ID format</strong> to <strong>EmailAddress</strong>, then click <strong>Next</strong> to finish creating the app.</div>
            <div class="wizard-note"><strong>Email and name need no SAML setup</strong> — Rush identifies the user from the SAML <strong>NameID</strong> (their email), so login works without any attribute statements.</div>
            <div class="wizard-instruction"><strong>Only if you use group-based roles:</strong> after the app is created, open it &rarr; <strong>Sign On</strong> tab &rarr; <strong>Attribute statements</strong> card &rarr; <strong>Show legacy configuration</strong> &rarr; under <strong>Group attribute statements</strong> add — Name <code>groups</code>, Name format <strong>Unspecified</strong>, Filter <strong>Matches regex</strong>, value <code>.*</code></div>
          </div>

          <div v-if="guidedStep === 3" class="wizard-step-content">
            <div class="wizard-title">Enter your IdP details</div>
            <div class="wizard-instruction">In Okta, on the app's <strong>Sign On</strong> tab, expand the SAML <strong>Metadata details</strong> (or <strong>View SAML setup instructions</strong>) and copy these:</div>
            <div class="form-group-inline">
              <label class="form-label">IdP Certificate</label>
              <textarea v-model="wizardCert" :class="['form-input', 'mono', { 'input-error': touched.cert && fieldErrors.cert }]" rows="4" placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----" style="font-size: 11px; resize: vertical;" @blur="touchField('cert')"></textarea>
              <div class="field-hint">Okta's <strong>Signing Certificate</strong> — click <strong>Copy</strong> (or Download the .cert and paste its contents here).</div>
              <div v-if="touched.cert && fieldErrors.cert" class="field-error">{{ fieldErrors.cert }}</div>
            </div>
            <div class="form-group-inline">
              <label class="form-label">SSO URL</label>
              <input v-model="wizardSsoUrl" :class="['form-input', 'mono', { 'input-error': touched.ssoUrl && fieldErrors.ssoUrl }]" placeholder="https://your-org.okta.com/app/.../sso/saml" @blur="touchField('ssoUrl')" />
              <div class="field-hint">Okta's <strong>Sign on URL</strong> (not the Metadata URL or Issuer).</div>
              <div v-if="touched.ssoUrl && fieldErrors.ssoUrl" class="field-error">{{ fieldErrors.ssoUrl }}</div>
            </div>
          </div>

          <div v-if="guidedStep === 4" class="wizard-step-content">
            <div class="wizard-title">Review and save</div>
            <div class="wizard-review-summary">
              <div class="wizard-review-row"><span class="wizard-review-label">Provider</span><span>Okta (SAML)</span></div>
              <div class="wizard-review-row"><span class="wizard-review-label">SSO URL</span><span :class="fieldErrors.ssoUrl ? 'review-invalid' : 'review-valid'">{{ fieldErrors.ssoUrl ? '!' : '' }}</span><code class="mono" style="word-break: break-all;">{{ wizardSsoUrl || '(not set)' }}</code></div>
              <div class="wizard-review-row"><span class="wizard-review-label">Entity ID</span><code class="mono">{{ hostname }}</code></div>
              <div class="wizard-review-row"><span class="wizard-review-label">Certificate</span><span :class="fieldErrors.cert ? 'review-invalid' : 'review-valid'">{{ fieldErrors.cert ? '!' : '' }}</span><span>{{ wizardCert ? 'Provided' : 'Not set' }}</span></div>
            </div>
          </div>
        </template>

        <!-- ═══ Azure AD ═══ -->
        <template v-if="provider === 'azure'">
          <div v-if="guidedStep === 1" class="wizard-step-content">
            <div class="wizard-title">Create the SAML app in Azure AD</div>
            <div class="wizard-instruction">In Azure Portal, go to <strong>Azure Active Directory</strong> &rarr; <strong>Enterprise Applications</strong> &rarr; <strong>New Application</strong> &rarr; Non-gallery, SAML.</div>
          </div>

          <div v-if="guidedStep === 2" class="wizard-step-content">
            <div class="wizard-title">Configure Basic SAML settings</div>
            <div class="form-group-inline">
              <label class="form-label">Reply URL (ACS URL)</label>
              <div class="wizard-copyable-box">
                <code>{{ hostname }}/auth/sso/acs</code>
                <button class="btn-copy btn-copy-sm" @click="copyText(hostname + '/auth/sso/acs')">Copy</button>
              </div>
            </div>
            <div class="form-group-inline">
              <label class="form-label">Identifier (Entity ID)</label>
              <div class="wizard-copyable-box">
                <code>{{ hostname }}</code>
                <button class="btn-copy btn-copy-sm" @click="copyText(hostname)">Copy</button>
              </div>
            </div>
          </div>

          <div v-if="guidedStep === 3" class="wizard-step-content">
            <div class="wizard-title">Add a group claim and configure attribute mapping</div>
            <div class="wizard-instruction">Under <strong>User Attributes & Claims</strong>, add a group claim that emits <strong>Security groups</strong> with the attribute name <code class="mono">groups</code>.</div>
            <div class="form-group-inline" style="margin-top: var(--sp-2);">
              <label class="form-label">Email Claim</label>
              <input v-model="wizardEmailClaim" :class="['form-input', 'mono', { 'input-error': touched.emailClaim && fieldErrors.emailClaim }]" placeholder="email" @blur="touchField('emailClaim')" />
              <div v-if="touched.emailClaim && fieldErrors.emailClaim" class="field-error">{{ fieldErrors.emailClaim }}</div>
              <div class="field-hint">The claim/attribute name containing the user's email address</div>
            </div>
            <div class="form-group-inline">
              <label class="form-label">First Name Claim</label>
              <input v-model="wizardFirstNameClaim" class="form-input mono" placeholder="FirstName" />
              <div class="field-hint">The claim for the user's first name (OIDC: first_name, SAML: FirstName)</div>
            </div>
            <div class="form-group-inline">
              <label class="form-label">Last Name Claim</label>
              <input v-model="wizardLastNameClaim" class="form-input mono" placeholder="LastName" />
              <div class="field-hint">The claim for the user's last name (OIDC: last_name, SAML: LastName)</div>
            </div>
          </div>

          <div v-if="guidedStep === 4" class="wizard-step-content">
            <div class="wizard-title">Enter your IdP details</div>
            <div class="wizard-instruction">Download the Base64 certificate and copy the Login URL from Azure:</div>
            <div class="form-group-inline">
              <label class="form-label">IdP Certificate</label>
              <textarea v-model="wizardCert" :class="['form-input', 'mono', { 'input-error': touched.cert && fieldErrors.cert }]" rows="4" placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----" style="font-size: 11px; resize: vertical;" @blur="touchField('cert')"></textarea>
              <div v-if="touched.cert && fieldErrors.cert" class="field-error">{{ fieldErrors.cert }}</div>
            </div>
            <div class="form-group-inline">
              <label class="form-label">Login URL</label>
              <input v-model="wizardSsoUrl" :class="['form-input', 'mono', { 'input-error': touched.ssoUrl && fieldErrors.ssoUrl }]" placeholder="https://login.microsoftonline.com/.../saml2" @blur="touchField('ssoUrl')" />
              <div v-if="touched.ssoUrl && fieldErrors.ssoUrl" class="field-error">{{ fieldErrors.ssoUrl }}</div>
            </div>
          </div>

          <div v-if="guidedStep === 5" class="wizard-step-content">
            <div class="wizard-title">Review and save</div>
            <div class="wizard-review-summary">
              <div class="wizard-review-row"><span class="wizard-review-label">Provider</span><span>Azure AD (SAML)</span></div>
              <div class="wizard-review-row"><span class="wizard-review-label">Login URL</span><span :class="fieldErrors.ssoUrl ? 'review-invalid' : 'review-valid'">{{ fieldErrors.ssoUrl ? '!' : '' }}</span><code class="mono" style="word-break: break-all;">{{ wizardSsoUrl || '(not set)' }}</code></div>
              <div class="wizard-review-row"><span class="wizard-review-label">Entity ID</span><code class="mono">{{ hostname }}</code></div>
              <div class="wizard-review-row"><span class="wizard-review-label">Certificate</span><span :class="fieldErrors.cert ? 'review-invalid' : 'review-valid'">{{ fieldErrors.cert ? '!' : '' }}</span><span>{{ wizardCert ? 'Provided' : 'Not set' }}</span></div>
              <div class="wizard-review-row"><span class="wizard-review-label">Email Claim</span><code class="mono">{{ wizardEmailClaim }}</code></div>
              <div class="wizard-review-row"><span class="wizard-review-label">First Name</span><code class="mono">{{ wizardFirstNameClaim }}</code></div>
              <div class="wizard-review-row"><span class="wizard-review-label">Last Name</span><code class="mono">{{ wizardLastNameClaim }}</code></div>
            </div>
          </div>
        </template>

        <!-- ═══ Custom OIDC ═══ -->
        <template v-if="provider === 'custom-oidc'">
          <div v-if="guidedStep === 1" class="wizard-step-content">
            <div class="wizard-title">Enter your OIDC provider details</div>
            <div class="form-group-inline">
              <label class="form-label">Provider Name</label>
              <input v-model="wizardProviderName" :class="['form-input', { 'input-error': touched.providerName && fieldErrors.providerName }]" placeholder="e.g. Keycloak, Auth0" @blur="touchField('providerName')" />
              <div v-if="touched.providerName && fieldErrors.providerName" class="field-error">{{ fieldErrors.providerName }}</div>
            </div>
            <div class="form-group-inline">
              <label class="form-label">Issuer URL</label>
              <input v-model="wizardIssuerUrl" :class="['form-input', 'mono', { 'input-error': touched.issuerUrl && fieldErrors.issuerUrl }]" placeholder="https://your-idp.example.com" @blur="touchField('issuerUrl')" />
              <div v-if="touched.issuerUrl && fieldErrors.issuerUrl" class="field-error">{{ fieldErrors.issuerUrl }}</div>
            </div>
            <div class="form-group-inline">
              <label class="form-label">Client ID</label>
              <input v-model="wizardClientId" :class="['form-input', 'mono', { 'input-error': touched.clientId && fieldErrors.clientId }]" placeholder="client-id" @blur="touchField('clientId')" />
              <div v-if="touched.clientId && fieldErrors.clientId" class="field-error">{{ fieldErrors.clientId }}</div>
            </div>
            <div class="form-group-inline">
              <label class="form-label">Client Secret</label>
              <input v-model="wizardClientSecret" type="password" :class="['form-input', 'mono', { 'input-error': touched.clientSecret && fieldErrors.clientSecret }]" placeholder="client-secret" @blur="touchField('clientSecret')" />
              <div v-if="touched.clientSecret && fieldErrors.clientSecret" class="field-error">{{ fieldErrors.clientSecret }}</div>
            </div>
          </div>

          <div v-if="guidedStep === 2" class="wizard-step-content">
            <div class="wizard-title">Configure scopes and claims</div>
            <div class="form-group-inline">
              <label class="form-label">Scopes</label>
              <input v-model="wizardOidcScopes" class="form-input mono" placeholder="openid profile email groups" />
            </div>
            <div class="form-group-inline">
              <label class="form-label">Groups Claim</label>
              <input v-model="wizardGroupsClaim" :class="['form-input', 'mono', { 'input-error': touched.groupsClaim && fieldErrors.groupsClaim }]" placeholder="groups" @blur="touchField('groupsClaim')" />
              <div v-if="touched.groupsClaim && fieldErrors.groupsClaim" class="field-error">{{ fieldErrors.groupsClaim }}</div>
            </div>
            <div class="form-group-inline">
              <label class="form-label">Email Claim</label>
              <input v-model="wizardEmailClaim" :class="['form-input', 'mono', { 'input-error': touched.emailClaim && fieldErrors.emailClaim }]" placeholder="email" @blur="touchField('emailClaim')" />
              <div v-if="touched.emailClaim && fieldErrors.emailClaim" class="field-error">{{ fieldErrors.emailClaim }}</div>
              <div class="field-hint">The claim/attribute name containing the user's email address</div>
            </div>
            <div class="form-group-inline">
              <label class="form-label">First Name Claim</label>
              <input v-model="wizardFirstNameClaim" class="form-input mono" placeholder="first_name" />
              <div class="field-hint">The claim for the user's first name (OIDC: first_name, SAML: FirstName)</div>
            </div>
            <div class="form-group-inline">
              <label class="form-label">Last Name Claim</label>
              <input v-model="wizardLastNameClaim" class="form-input mono" placeholder="last_name" />
              <div class="field-hint">The claim for the user's last name (OIDC: last_name, SAML: LastName)</div>
            </div>
          </div>

          <div v-if="guidedStep === 3" class="wizard-step-content">
            <div class="wizard-title">Review and save</div>
            <div class="wizard-review-summary">
              <div class="wizard-review-row"><span class="wizard-review-label">Provider</span><span>{{ wizardProviderName || 'Custom OIDC' }}</span></div>
              <div class="wizard-review-row"><span class="wizard-review-label">Issuer URL</span><span :class="fieldErrors.issuerUrl ? 'review-invalid' : 'review-valid'">{{ fieldErrors.issuerUrl ? '!' : '' }}</span><code class="mono" style="word-break: break-all;">{{ wizardIssuerUrl || '(not set)' }}</code></div>
              <div class="wizard-review-row"><span class="wizard-review-label">Client ID</span><span :class="fieldErrors.clientId ? 'review-invalid' : 'review-valid'">{{ fieldErrors.clientId ? '!' : '' }}</span><code class="mono">{{ wizardClientId || '(not set)' }}</code></div>
              <div class="wizard-review-row"><span class="wizard-review-label">Scopes</span><code class="mono">{{ wizardOidcScopes }}</code></div>
              <div class="wizard-review-row"><span class="wizard-review-label">Groups Claim</span><code class="mono">{{ wizardGroupsClaim }}</code></div>
              <div class="wizard-review-row"><span class="wizard-review-label">Email Claim</span><code class="mono">{{ wizardEmailClaim }}</code></div>
              <div class="wizard-review-row"><span class="wizard-review-label">First Name</span><code class="mono">{{ wizardFirstNameClaim }}</code></div>
              <div class="wizard-review-row"><span class="wizard-review-label">Last Name</span><code class="mono">{{ wizardLastNameClaim }}</code></div>
            </div>
          </div>
        </template>

        <!-- ═══ Custom SAML ═══ -->
        <template v-if="provider === 'custom-saml'">
          <div v-if="guidedStep === 1" class="wizard-step-content">
            <div class="wizard-title">Configure your IdP with these values</div>
            <div class="form-group-inline">
              <label class="form-label">ACS URL</label>
              <div class="wizard-copyable-box">
                <code>{{ hostname }}/auth/sso/acs</code>
                <button class="btn-copy btn-copy-sm" @click="copyText(hostname + '/auth/sso/acs')">Copy</button>
              </div>
            </div>
            <div class="form-group-inline">
              <label class="form-label">Entity ID</label>
              <div class="wizard-copyable-box">
                <code>{{ hostname }}</code>
                <button class="btn-copy btn-copy-sm" @click="copyText(hostname)">Copy</button>
              </div>
            </div>
          </div>

          <div v-if="guidedStep === 2" class="wizard-step-content">
            <div class="wizard-title">Enter your IdP details</div>
            <div class="form-group-inline">
              <label class="form-label">IdP SSO URL</label>
              <input v-model="wizardSsoUrl" :class="['form-input', 'mono', { 'input-error': touched.ssoUrl && fieldErrors.ssoUrl }]" placeholder="https://idp.example.com/saml/sso" @blur="touchField('ssoUrl')" />
              <div v-if="touched.ssoUrl && fieldErrors.ssoUrl" class="field-error">{{ fieldErrors.ssoUrl }}</div>
            </div>
            <div class="form-group-inline">
              <label class="form-label">IdP Certificate</label>
              <textarea v-model="wizardCert" :class="['form-input', 'mono', { 'input-error': touched.cert && fieldErrors.cert }]" rows="4" placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----" style="font-size: 11px; resize: vertical;" @blur="touchField('cert')"></textarea>
              <div v-if="touched.cert && fieldErrors.cert" class="field-error">{{ fieldErrors.cert }}</div>
            </div>
            <div class="form-group-inline" style="margin-top: var(--sp-2);">
              <label class="form-label">Email Claim</label>
              <input v-model="wizardEmailClaim" :class="['form-input', 'mono', { 'input-error': touched.emailClaim && fieldErrors.emailClaim }]" placeholder="email" @blur="touchField('emailClaim')" />
              <div v-if="touched.emailClaim && fieldErrors.emailClaim" class="field-error">{{ fieldErrors.emailClaim }}</div>
              <div class="field-hint">The claim/attribute name containing the user's email address</div>
            </div>
            <div class="form-group-inline">
              <label class="form-label">First Name Claim</label>
              <input v-model="wizardFirstNameClaim" class="form-input mono" placeholder="FirstName" />
              <div class="field-hint">The claim for the user's first name (OIDC: first_name, SAML: FirstName)</div>
            </div>
            <div class="form-group-inline">
              <label class="form-label">Last Name Claim</label>
              <input v-model="wizardLastNameClaim" class="form-input mono" placeholder="LastName" />
              <div class="field-hint">The claim for the user's last name (OIDC: last_name, SAML: LastName)</div>
            </div>
          </div>

          <div v-if="guidedStep === 3" class="wizard-step-content">
            <div class="wizard-title">Review and save</div>
            <div class="wizard-review-summary">
              <div class="wizard-review-row"><span class="wizard-review-label">Provider</span><span>Custom SAML</span></div>
              <div class="wizard-review-row"><span class="wizard-review-label">SSO URL</span><span :class="fieldErrors.ssoUrl ? 'review-invalid' : 'review-valid'">{{ fieldErrors.ssoUrl ? '!' : '' }}</span><code class="mono" style="word-break: break-all;">{{ wizardSsoUrl || '(not set)' }}</code></div>
              <div class="wizard-review-row"><span class="wizard-review-label">Entity ID</span><code class="mono">{{ hostname }}</code></div>
              <div class="wizard-review-row"><span class="wizard-review-label">Certificate</span><span :class="fieldErrors.cert ? 'review-invalid' : 'review-valid'">{{ fieldErrors.cert ? '!' : '' }}</span><span>{{ wizardCert ? 'Provided' : 'Not set' }}</span></div>
              <div class="wizard-review-row"><span class="wizard-review-label">Email Claim</span><code class="mono">{{ wizardEmailClaim }}</code></div>
              <div class="wizard-review-row"><span class="wizard-review-label">First Name</span><code class="mono">{{ wizardFirstNameClaim }}</code></div>
              <div class="wizard-review-row"><span class="wizard-review-label">Last Name</span><code class="mono">{{ wizardLastNameClaim }}</code></div>
            </div>
          </div>
        </template>

        <!-- Navigation -->
        <div class="wizard-nav">
          <button v-if="guidedStep > 1" class="btn btn-secondary" @click="stepBack">Back</button>
          <span v-else></span>
          <button
            v-if="guidedStep < totalSteps"
            class="btn btn-primary"
            @click="stepNext"
            :disabled="!stepValid"
          >
            Next
          </button>
          <button
            v-if="guidedStep === totalSteps"
            class="btn btn-primary"
            @click="saveSetup"
            :disabled="saving || !stepValid"
          >
            {{ saving ? 'Saving...' : 'Save SSO' }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* ── Page layout ── */
.sso-setup-page {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-root);
  background-image: radial-gradient(circle, rgba(59, 130, 246, 0.03) 1px, transparent 1px);
  background-size: 24px 24px;
}
.sso-setup-card {
  width: 100%;
  max-width: 640px;
  max-height: 90vh;
  overflow-y: auto;
  padding: var(--sp-8);
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-4);
}
.sso-setup-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
  margin-bottom: var(--sp-4);
}
.login-logo {
  height: 32px;
  width: auto;
  opacity: 0.9;
}
.login-title {
  font-family: var(--font-mono);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.03em;
  color: var(--text-primary);
}
.login-title-dim {
  color: var(--text-muted);
  font-weight: 400;
}
.login-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: var(--amber);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.sso-setup-error {
  text-align: center;
  padding: var(--sp-6);
}
.sso-setup-error-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--sp-2);
}
.sso-setup-error-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  max-width: 42ch;
  margin: 0 auto;
}

/* ── Wizard step indicator ── */
.wizard-step-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  width: 100%;
  margin-bottom: var(--sp-2);
}
.wizard-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--border-default);
  transition: background 0.2s, box-shadow 0.2s;
  flex-shrink: 0;
}
.wizard-dot-active {
  background: var(--amber);
}
.wizard-dot-current {
  background: var(--amber);
  box-shadow: 0 0 0 3px var(--amber-dim);
}
.wizard-line {
  width: 32px;
  height: 2px;
  background: var(--border-default);
  transition: background 0.2s;
}
.wizard-line-active {
  background: var(--amber);
}
.wizard-step-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--amber);
  text-align: center;
  margin-bottom: var(--sp-1);
}

/* ── Wizard content ── */
.wizard-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  text-align: center;
  margin-bottom: var(--sp-2);
}
.wizard-step-content {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  width: 100%;
  text-align: left;
}
.wizard-instruction {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.wizard-note {
  margin-top: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
  background: var(--amber-dim);
  border-left: 2px solid var(--amber);
  border-radius: var(--r-sm);
}
.wizard-note strong { color: var(--amber); }
.wizard-note em { color: var(--text-primary); font-style: normal; font-weight: 600; }
.wizard-instruction strong {
  color: var(--text-primary);
}
.wizard-instruction code {
  color: var(--amber);
  font-family: var(--font-mono);
  font-size: 12px;
}
.wizard-copyable-box {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  background: var(--bg-root);
  border: 1px solid var(--border-default);
  border-radius: var(--r-sm);
  padding: var(--sp-2) var(--sp-3);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-primary);
}
.wizard-copyable-box code {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-primary);
}

/* ── Review summary ── */
.wizard-review-summary {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  width: 100%;
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--r-md);
  padding: var(--sp-3);
}
.wizard-review-row {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  font-size: 12px;
  color: var(--text-primary);
}
.wizard-review-label {
  flex-shrink: 0;
  width: 100px;
  font-weight: 600;
  color: var(--text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding-top: 1px;
}

/* ── Navigation ── */
.wizard-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  margin-top: var(--sp-2);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--border-subtle);
}

/* ── Form elements (shared with settings) ── */
.form-group-inline {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.form-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.form-input {
  padding: var(--sp-2) var(--sp-3);
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--r-md);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.5;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.form-input:focus {
  border-color: var(--amber);
  box-shadow: 0 0 0 2px var(--amber-dim);
  outline: none;
}
.form-input::placeholder {
  color: var(--text-muted);
}

/* ── Buttons ── */
.btn {
  padding: var(--sp-2) var(--sp-4);
  font-size: 12px;
  font-weight: 600;
  border-radius: var(--r-md);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  border: 1px solid transparent;
}
.btn-primary {
  background: var(--amber);
  color: var(--text-inverse);
}
.btn-primary:hover:not(:disabled) {
  background: var(--amber-hover);
}
.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-secondary {
  background: var(--bg-raised);
  color: var(--text-primary);
  border-color: var(--border-default);
}
.btn-secondary:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}
.btn-copy {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 10px;
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--r-sm);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}
.btn-copy:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.btn-copy-sm {
  font-size: 10px;
  padding: 2px 8px;
}
.mono {
  font-family: var(--font-mono);
}

/* ── Validation ── */
.input-error {
  border-color: var(--error) !important;
}
.field-error {
  font-size: 11px;
  color: var(--error);
  margin-top: 2px;
}
.field-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}
.review-valid {
  color: var(--success, #4ade80);
  font-size: 12px;
  margin-right: 4px;
}
.review-invalid {
  color: var(--error);
  font-size: 12px;
  font-weight: 600;
  margin-right: 4px;
}
</style>
