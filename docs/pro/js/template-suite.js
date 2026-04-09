/**
 * NBD Pro - Template Suite Module
 * Production-grade template management system for roofing/exterior CRM
 * Supports: Email, Estimate, Contract, Scope of Work, Follow-up Sequences
 * Storage: localStorage primary, Firestore sync ready
 */

const NBDTemplateSuite = (() => {
  const STORAGE_KEY = 'nbd_template_suite';
  const TYPE_COLORS = {
    email: '#2196F3',
    estimate: '#FF9800',
    contract: '#4CAF50',
    scope_of_work: '#9C27B0',
    sequence: '#00BCD4'
  };

  let templates = [];
  let currentTemplate = null;
  let editorModal = null;

  // ============================================================================
  // INITIALIZATION & STORAGE
  // ============================================================================

  function initializeSuite() {
    loadFromStorage();
    if (templates.length === 0) {
      seedDefaultTemplates();
      saveToStorage();
    }
    exposePublicAPI();
  }

  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      templates = stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.error('Failed to load templates from storage', e);
      templates = [];
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
      // Attempt Firestore sync if available
      if (window._db && window._user) {
        syncToFirestore();
      }
    } catch (e) {
      console.error('Failed to save templates to storage', e);
    }
  }

  function syncToFirestore() {
    if (!window._db || !window._user?.uid) return;
    const db = window._db;
    const userId = window._user.uid;
    const batch = db.batch();

    templates.forEach(tpl => {
      const ref = db.collection('users').doc(userId)
        .collection('templates').doc(tpl.id);
      batch.set(ref, tpl, { merge: true });
    });

    batch.commit().catch(e => console.error('Firestore sync failed:', e));
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  function createTemplate(data) {
    const newTemplate = {
      id: `${data.type.substring(0, 3)}_${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      useCount: 0,
      lastUsedAt: null,
      isActive: true,
      isDefault: false,
      ...data
    };
    templates.push(newTemplate);
    saveToStorage();
    window._showToast?.(`Template "${newTemplate.name}" created`);
    return newTemplate;
  }

  function updateTemplate(id, updates) {
    const idx = templates.findIndex(t => t.id === id);
    if (idx === -1) return null;
    templates[idx] = {
      ...templates[idx],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    saveToStorage();
    window._showToast?.('Template updated');
    return templates[idx];
  }

  function deleteTemplate(id) {
    const idx = templates.findIndex(t => t.id === id);
    if (idx === -1) return false;
    templates.splice(idx, 1);
    saveToStorage();
    window._showToast?.('Template deleted');
    return true;
  }

  function duplicateTemplate(id) {
    const original = templates.find(t => t.id === id);
    if (!original) return null;
    const copy = {
      ...original,
      id: `${original.type.substring(0, 3)}_${Date.now()}`,
      name: `${original.name} (Copy)`,
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      useCount: 0,
      lastUsedAt: null
    };
    templates.push(copy);
    saveToStorage();
    window._showToast?.('Template duplicated');
    return copy;
  }

  function getTemplate(id) {
    return templates.find(t => t.id === id);
  }

  function getAllTemplates() {
    return [...templates];
  }

  function getTemplatesByType(type) {
    return templates.filter(t => t.type === type);
  }

  function getTemplatesByCategory(category) {
    return templates.filter(t => t.category === category);
  }

  function searchTemplates(query) {
    const q = query.toLowerCase();
    return templates.filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.description && t.description.toLowerCase().includes(q))
    );
  }

  function recordTemplateUsage(id) {
    const tpl = templates.find(t => t.id === id);
    if (tpl) {
      tpl.useCount = (tpl.useCount || 0) + 1;
      tpl.lastUsedAt = new Date().toISOString();
      saveToStorage();
    }
  }

  // ============================================================================
  // MERGE FIELD SYSTEM
  // ============================================================================

  const AVAILABLE_MERGE_FIELDS = {
    firstName: 'Contact first name',
    lastName: 'Contact last name',
    address: 'Property street address',
    city: 'City',
    state: 'State',
    zip: 'Zip code',
    companyName: 'NBD Pro company name',
    agentName: 'Sales rep name',
    agentPhone: 'Sales rep phone',
    agentEmail: 'Sales rep email',
    claimNumber: 'Insurance claim number',
    estimateAmount: 'Estimate total',
    scheduledDate: 'Appointment/crew date',
    crewName: 'Installation crew leader',
    scopeOfWork: 'Work scope description',
    totalPrice: 'Contract total price',
    paymentTerms: 'Payment schedule',
    startDate: 'Project start date',
    completionDate: 'Project completion date'
  };

  const SAMPLE_DATA = {
    firstName: 'John',
    lastName: 'Smith',
    address: '1234 Maple Street',
    city: 'Denver',
    state: 'CO',
    zip: '80202',
    companyName: 'NBD Pro - No Big Deal Home Solutions',
    agentName: 'Sarah Johnson',
    agentPhone: '(303) 555-0147',
    agentEmail: 'sarah@nbdpro.com',
    claimNumber: 'CLM-2026-012847',
    estimateAmount: '$8,500',
    scheduledDate: 'March 15, 2026',
    crewName: 'Mike Rodriguez',
    scopeOfWork: 'Complete roof tear-off and replacement with architectural shingles',
    totalPrice: '$8,500',
    paymentTerms: '50% deposit, balance due upon completion',
    startDate: 'March 15, 2026',
    completionDate: 'March 17, 2026'
  };

  function getAvailableMergeFields() {
    return Object.entries(AVAILABLE_MERGE_FIELDS).map(([key, desc]) => ({
      field: key,
      placeholder: `{{${key}}}`,
      description: desc
    }));
  }

  function previewWithSampleData(template) {
    let content = template.type === 'email'
      ? `<strong>${template.subject}</strong>\n\n${template.body}`
      : template.body || template.content || '';

    Object.entries(SAMPLE_DATA).forEach(([key, value]) => {
      content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
    });

    return content;
  }

  function insertMergeField(fieldKey, textareaId) {
    const textarea = document.getElementById(textareaId);
    if (!textarea) return;
    const placeholder = `{{${fieldKey}}}`;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.substring(0, start);
    const after = textarea.value.substring(end);
    textarea.value = before + placeholder + after;
    textarea.selectionStart = textarea.selectionEnd = start + placeholder.length;
    textarea.focus();
  }

  // ============================================================================
  // DEMO DATA SEEDING
  // ============================================================================

  function seedDefaultTemplates() {
    // EMAIL TEMPLATES
    templates.push({
      id: 'etpl_initial_contact',
      name: 'Initial Contact — Welcome',
      type: 'email',
      category: 'general',
      stage: 'lead',
      subject: 'Thanks for Reaching Out, {{firstName}}',
      body: `<p>Hi {{firstName}},</p>

<p>Thanks so much for taking the time to contact us about your roof! We really appreciate the opportunity to help protect one of your home's most important assets.</p>

<p>At NBD Pro, we specialize in residential roofing and exterior work. Whether you're dealing with storm damage, a roof that's seen better days, or you're just ready for an upgrade, we're here to help—and we'll make the process simple and straightforward (no big deal, really!).</p>

<p>Next steps? We'd love to get out and take a look at your roof with a FREE, no-pressure inspection. Our inspection includes a detailed walk-through, photos, and a clear explanation of what we find—no obligations. We typically schedule inspections within 24-48 hours of your request.</p>

<p>How does this week look for you? {{agentName}} will reach out shortly to find the perfect time. You can also reply to this email or call us directly at {{agentPhone}} to lock in a time that works best.</p>

<p>Looking forward to meeting you and earning your business!</p>

<p>Best regards,<br>{{agentName}}<br>{{companyName}}<br>{{agentPhone}} | {{agentEmail}}</p>`,
      description: 'Sent immediately after lead contact. Sets tone, introduces free inspection.',
      isDefault: true,
      sortOrder: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    templates.push({
      id: 'etpl_post_inspection',
      name: 'Post-Inspection Summary',
      type: 'email',
      category: 'insurance_pipeline',
      stage: 'inspected',
      subject: 'Your Roof Inspection Results — {{firstName}}',
      body: `<p>Hi {{firstName}},</p>

<p>Thanks again for letting us inspect your roof on {{scheduledDate}}! We really enjoyed meeting you and getting a closer look at your property at {{address}}.</p>

<p>Here's what we found:</p>

<p>{{scopeOfWork}}</p>

<p>We've prepared a detailed estimate for the work, which we'll walk through with you over the phone or at your home—whichever you prefer. Our estimate includes all labor, materials, permit fees (if applicable), and our 10-year workmanship warranty. There are no hidden costs.</p>

<p>The next step is simple: we'll either submit this estimate to your insurance company (if you have coverage), help you explore financing options, or discuss a cash price. Most homeowners in your situation have their claim approved and approved supplement paid within 2-4 weeks.</p>

<p>{{agentName}} will call you within 24 hours to go over the findings and answer any questions. If you'd like to talk sooner, just reply to this email or give us a call at {{agentPhone}}.</p>

<p>We're excited to get your roof taken care of!</p>

<p>Best,<br>{{agentName}}<br>{{companyName}}</p>`,
      description: 'Sent after roof inspection. Summarizes findings and next steps.',
      isDefault: true,
      sortOrder: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    templates.push({
      id: 'etpl_claim_filed',
      name: 'Claim Filed Notification',
      type: 'email',
      category: 'insurance_pipeline',
      stage: 'claim_filed',
      subject: 'Your Insurance Claim Has Been Filed',
      body: `<p>Hi {{firstName}},</p>

<p>Great news! We've officially filed your insurance claim on {{scheduledDate}}. Your claim number is {{claimNumber}}, and you'll want to save this for your records.</p>

<p>Here's what happens next:</p>

<p><strong>1. Adjuster Assignment (2-5 days)</strong><br>
Your insurance company will assign an adjuster to your claim. They'll likely reach out directly to you to schedule an inspection. This is standard procedure.</p>

<p><strong>2. Adjuster Inspection (5-10 days)</strong><br>
The adjuster will visit the property, take their own photos and measurements, and prepare their assessment. We can attend this meeting with you if you'd like—it's often helpful to have us there to explain the damage and scope of work.</p>

<p><strong>3. Estimate Submitted (1-2 weeks after adjuster visit)</strong><br>
Once the adjuster has completed their report, we'll submit our detailed estimate to the insurance company. They'll compare it to the adjuster's findings and get back to you with their approval decision.</p>

<p>Timeline? Typically 2-4 weeks from claim filing to approval. We'll keep you updated every step of the way—no surprises.</p>

<p>Questions about your claim? Feel free to reach out to {{agentName}} at {{agentPhone}}. We've done hundreds of claims like yours, and we know the process well.</p>

<p>Talk soon!</p>

<p>{{agentName}}<br>{{companyName}}</p>`,
      description: 'Sent when insurance claim is officially filed.',
      isDefault: true,
      sortOrder: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    templates.push({
      id: 'etpl_adjuster_scheduled',
      name: 'Adjuster Meeting Scheduled',
      type: 'email',
      category: 'insurance_pipeline',
      stage: 'adjuster_scheduled',
      subject: 'Your Insurance Adjuster Visit — {{scheduledDate}}',
      body: `<p>Hi {{firstName}},</p>

<p>Your insurance adjuster has confirmed an appointment on {{scheduledDate}}. Here are the details:</p>

<p><strong>Time:</strong> [Adjuster will contact you directly with exact time]<br>
<strong>Location:</strong> {{address}}<br>
<strong>What to expect:</strong> 30-45 minute on-site inspection</p>

<p><strong>A few tips to help the process go smoothly:</strong></p>

<p>1. <strong>Be present.</strong> The adjuster will want to walk the property with a homeowner present to answer questions and point out any concerns.<br>
2. <strong>Have photos ready.</strong> If you took photos of the damage after the storm, have them available.<br>
3. <strong>Ask questions.</strong> Don't hesitate to ask the adjuster to explain anything you don't understand.<br>
4. <strong>Consider having us attend.</strong> We're happy to join the inspection call or meeting ({{agentPhone}}) to explain the scope of work and damage details.<br>
5. <strong>Take notes.</strong> Write down what the adjuster tells you about timing and next steps.</p>

<p>The adjuster works for the insurance company, but they're trained professionals who will give an honest assessment of the damage. Our job is to provide a detailed, realistic estimate of repair costs so the insurance company can make a fair decision.</p>

<p>After the adjuster visit, we'll submit our official estimate to the insurance company. Once they review both reports, they'll send you their approval and payment decision—typically within 1-2 weeks.</p>

<p>Questions before the visit? Just reach out to {{agentName}} at {{agentPhone}}.</p>

<p>We've got this!</p>

<p>{{agentName}}<br>{{companyName}}</p>`,
      description: 'Sent when adjuster inspection is scheduled.',
      isDefault: true,
      sortOrder: 4,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    templates.push({
      id: 'etpl_estimate_submitted',
      name: 'Estimate Submitted to Insurance',
      type: 'email',
      category: 'insurance_pipeline',
      stage: 'estimate_submitted',
      subject: 'Your Roof Estimate Has Been Submitted',
      body: `<p>Hi {{firstName}},</p>

<p>Excellent news! We've officially submitted our detailed estimate to {{firstName}}'s insurance company. The estimate amount is {{estimateAmount}} and includes all labor, materials, and permits.</p>

<p><strong>What happens now:</strong></p>

<p>The insurance company will compare our estimate to their adjuster's report. They're looking to see if our scope of work matches their findings. In our experience, most estimates are approved within 7-10 business days.</p>

<p><strong>What if they request changes?</strong><br>
Sometimes insurance companies request clarifications or may adjust their assessment slightly. If that happens, we work directly with the insurance company to resolve any discrepancies. You'll be copied on all communication.</p>

<p><strong>Can we start work before approval?</strong><br>
No—we always wait for the insurance company's written approval before scheduling your crew. This protects you by ensuring the insurance company has signed off on the scope and cost.</p>

<p><strong>Timeline:</strong><br>
- Approval decision: 7-10 days (typically)<br>
- Insurance check mailed to you: 1-2 weeks after approval<br>
- Crew scheduled: Immediately after you deposit your portion<br>
- Installation: 1-3 days (depending on roof size)</p>

<p>We'll check in with the insurance company in about a week to see if they have any questions or need additional information. If you have questions in the meantime, please call {{agentName}} at {{agentPhone}}.</p>

<p>Hang tight—we're close!</p>

<p>{{agentName}}<br>{{companyName}}</p>`,
      description: 'Sent after estimate is submitted to insurance.',
      isDefault: true,
      sortOrder: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    templates.push({
      id: 'etpl_estimate_approved',
      name: 'Estimate Approved by Insurance',
      type: 'email',
      category: 'insurance_pipeline',
      stage: 'approved',
      subject: 'Great News! Your Roof Estimate Has Been Approved',
      body: `<p>Hi {{firstName}},</p>

<p><strong>Your insurance estimate has been APPROVED!</strong></p>

<p>This is fantastic news. The insurance company has reviewed our estimate and their adjuster's report, and they've approved the full amount of {{estimateAmount}}. They'll be mailing you a check shortly.</p>

<p><strong>Here's what happens next:</strong></p>

<p><strong>1. You receive the insurance check</strong><br>
The check will arrive in 1-2 weeks. The check is typically made out to both you and your mortgage lender (if you have a mortgage). Your lender will need to endorse the check before you can deposit it. This process usually takes 2-5 business days once they receive it.</p>

<p><strong>2. You deposit your portion</strong><br>
Once you have your portion of the funds, we'll need a signed contract and your deposit (typically 50% of the total cost, minus what insurance is paying) to schedule your crew.</p>

<p><strong>3. We schedule your installation</strong><br>
We have crews available and typically can schedule installation within 1-2 weeks of receiving your deposit. We'll work around your schedule.</p>

<p><strong>4. Crew shows up and completes the work</strong><br>
Most residential roofs are completed in 1-2 days. Your crew leader is {{crewName}}, one of our most experienced installers. He'll protect your property, coordinate timing with you, and answer any questions during the work.</p>

<p><strong>Total timeline from approval to completed roof: 3-4 weeks** (depending on lender endorsement and your schedule).</p>

<p>Next step: Once you've deposited your portion of the insurance check, please give us a call at {{agentPhone}} or email {{agentEmail}} with:</p>

<ul>
<li>Confirmation of deposit</li>
<li>Your preferred start date</li>
<li>Any questions or special requests</li>
</ul>

<p>{{agentName}} will get everything locked in and you'll hear from {{crewName}}'s team 24 hours before the scheduled start date.</p>

<p>This is a big moment—your roof is going to look amazing. We're excited to get started!</p>

<p>{{agentName}}<br>{{companyName}}<br>{{agentPhone}}</p>`,
      description: 'Sent when insurance approves and issues payment.',
      isDefault: true,
      sortOrder: 6,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    templates.push({
      id: 'etpl_crew_scheduled',
      name: 'Crew Scheduled — Ready to Work',
      type: 'email',
      category: 'insurance_pipeline',
      stage: 'crew_scheduled',
      subject: 'Your Roof Installation is Scheduled for {{scheduledDate}}',
      body: `<p>Hi {{firstName}},</p>

<p>Your roof installation is officially scheduled! Here are the details:</p>

<p><strong>Installation Date:</strong> {{scheduledDate}}<br>
<strong>Property:</strong> {{address}}<br>
<strong>Crew Leader:</strong> {{crewName}}<br>
<strong>Estimated Duration:</strong> 1-2 days<br>
<strong>Crew will arrive around:</strong> 7:00 AM (We'll call the day before with exact time)</p>

<p><strong>What to expect on installation day:</strong></p>

<p><strong>Early morning setup (7:00-7:30 AM)</strong><br>
The crew will arrive and begin setting up. They'll place protective tarps, establish their work area, and position equipment. You might hear some noise—this is normal.</p>

<p><strong>Tearoff and prep (7:30 AM-12:30 PM)</strong><br>
The old roof comes off, and the deck is inspected and prepped. You'll see a lot of activity and hear banging—this is the loudest part of the job.</p>

<p><strong>Underlayment and new shingles (12:30 PM-4:00 PM)</strong><br>
After lunch, the new underlayment goes down, followed by the new shingles. This is quieter but steady work.</p>

<p><strong>Next morning (if two-day job)</strong><br>
We'll finish any remaining work, complete final cleanup, haul off all debris, and do a final walkthrough with you.</p>

<p><strong>Important reminders:</strong></p>

<ul>
<li><strong>Be home or have someone there.</strong> We'll need access to the property and may have questions.</li>
<li><strong>Protect your vehicle and outdoor items.</strong> We'll have trucks and equipment in the driveway. Move vehicles if possible.</li>
<li><strong>Expect some mess.</strong> We'll clean up at the end, but shingles and nails may show up in gutters for a few weeks.</li>
<li><strong>Keep kids and pets indoors.</strong> For safety, keep them away from the work area.</li>
<li><strong>Have water and snacks available.</strong> The crew appreciates the kindness, and it helps morale.</li>
</ul>

<p><strong>After installation:</strong><br>
We'll do a final walkthrough with you, answer any questions, and provide your warranty documentation. You'll receive a 10-year workmanship warranty and manufacturer's material warranty information.</p>

<p>Questions before installation? Call {{agentName}} at {{agentPhone}} or email {{agentEmail}}. {{crewName}} will contact you the day before with exact timing.</p>

<p>Let's make your roof amazing!</p>

<p>{{agentName}}<br>{{companyName}}</p>`,
      description: 'Sent when crew installation date is confirmed.',
      isDefault: true,
      sortOrder: 7,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    templates.push({
      id: 'etpl_installation_complete',
      name: 'Installation Complete — Warranty Info',
      type: 'email',
      category: 'insurance_pipeline',
      stage: 'complete',
      subject: 'Your New Roof is Complete!',
      body: `<p>Hi {{firstName}},</p>

<p>Your roof installation is complete, and it looks outstanding! {{crewName}} and the crew did excellent work, and we really appreciate you being so easy to work with during the project.</p>

<p><strong>Here's what you now have:</strong></p>

<ul>
<li><strong>New architectural shingles</strong> with a 25-30 year lifespan</li>
<li><strong>10-year NBD Pro workmanship warranty</strong> on all labor</li>
<li><strong>25-year manufacturer material warranty</strong> on the shingles themselves</li>
<li><strong>Proper ventilation and flashing</strong> to prevent leaks and extend roof life</li>
</ul>

<p><strong>Your warranty covers:</strong></p>

<p><strong>Workmanship (10 years):</strong> Any issues with installation, workmanship, or leaks caused by our work are covered. We'll fix it at no charge during this period.</p>

<p><strong>Materials (25 years):</strong> The shingles are covered against defects and premature failure. If a shingle fails due to a manufacturer defect, the manufacturer will replace the defective shingles. We'll help facilitate any claims.</p>

<p><strong>Important maintenance tips to maximize your warranty:**</p>

<ul>
<li>Keep gutters clean (2x per year minimum)</li>
<li>Remove tree debris and moss (if applicable to your area)</li>
<li>Have us inspect after severe storms</li>
<li>Never pressure wash the roof (damages shingles)</li>
<li>Keep documentation of regular maintenance</li>
</ul>

<p><strong>Your warranty documents are attached.</strong> Keep these in a safe place—you may need them if you ever sell your home.</p>

<p><strong>Final invoice and payment:</strong><br>
Your final balance of {{estimateAmount}} (minus insurance payment) is now due. If you haven't already settled this, please remit payment within 7 days. You can:</p>

<ul>
<li>Mail a check to: NBD Pro, [Address]</li>
<li>Pay online: [Payment Link]</li>
<li>Call {{agentName}} at {{agentPhone}} to arrange payment</li>
</ul>

<p><strong>Next steps?</strong><br>
In 6 months, feel free to reach out for a quick roof inspection to make sure everything is performing perfectly. After that, we recommend annual inspections—it's a simple way to catch small issues before they become big problems.</p>

<p>If you have any questions about your roof, warranty, or need maintenance work in the future, don't hesitate to reach out. We're here to help.</p>

<p>Thanks for choosing NBD Pro!</p>

<p>{{agentName}}<br>{{companyName}}<br>{{agentPhone}}</p>`,
      description: 'Sent when installation is complete.',
      isDefault: true,
      sortOrder: 8,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    templates.push({
      id: 'etpl_review_request',
      name: 'Review Request — Google/Facebook',
      type: 'email',
      category: 'follow_up',
      stage: 'complete',
      subject: 'We\'d Love Your Feedback, {{firstName}}',
      body: `<p>Hi {{firstName}},</p>

<p>Your roof looks amazing, and we're thrilled with how the project turned out. We'd love to hear about your experience with NBD Pro!</p>

<p>If you have a few minutes, would you mind leaving us a quick review? Your feedback helps us serve our community better and shows potential customers what real clients think about our work.</p>

<p><strong>Where to leave a review:</strong></p>

<p><strong>Google:</strong> Search "NBD Pro" on Google, click our listing, and scroll to "Reviews." Your 5-star review takes about 30 seconds.</p>

<p><strong>Facebook:</strong> Visit our Facebook page at [Link] and leave a review in the "Reviews" section.</p>

<p><strong>What to mention (if you feel like it):</strong></p>

<ul>
<li>How smooth the process was</li>
<li>The quality of the workmanship</li>
<li>How professional and respectful the crew was</li>
<li>Whether we kept you informed throughout</li>
<li>How well we cleaned up</li>
</ul>

<p>We genuinely appreciate your business, and we're grateful for any positive feedback you're willing to share. These reviews are what help local families find trustworthy contractors.</p>

<p>If you have any concerns or issues with your roof, please reach out to us directly before leaving a review—we want to make sure you're 100% satisfied.</p>

<p>Thanks again for choosing NBD Pro!</p>

<p>{{agentName}}<br>{{companyName}}<br>{{agentPhone}}</p>`,
      description: 'Sent 7-14 days after completion. Requests review.',
      isDefault: true,
      sortOrder: 9,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    templates.push({
      id: 'etpl_referral_ask',
      name: 'Referral Request — Post-Job',
      type: 'email',
      category: 'follow_up',
      stage: 'complete',
      subject: 'Know Someone Who Needs a New Roof?',
      body: `<p>Hi {{firstName}},</p>

<p>Your new roof is installed, your warranty is in place, and hopefully you're enjoying not worrying about leaks or storm damage anymore!</p>

<p>We're still amazed by how many local homeowners struggle to find a trustworthy, straightforward roofing contractor. That's why we're asking for your help.</p>

<p><strong>Do you know anyone who might benefit from a new roof or exterior work?</strong></p>

<p>Whether it's a friend, family member, neighbor, or coworker, we'd be grateful if you'd think of NBD Pro when the topic comes up. You can:</p>

<ul>
<li><strong>Give them our number:</strong> {{agentPhone}} (tell them you referred us!)</li>
<li><strong>Share our website:</strong> [Website]</li>
<li><strong>Forward this email</strong> if they're interested in a free inspection</li>
<li><strong>Text or call us</strong> with their information, and we'll reach out respectfully</li>
</ul>

<p><strong>We take care of referrals:</strong></p>

<p>Every referral who becomes a customer earns you a $500 credit toward future services or $500 to your favorite local charity. We'll reach out to confirm, so there's no paperwork on your end—just let us know!</p>

<p>Thanks for spreading the word about NBD Pro. Word-of-mouth from satisfied customers like you is the best compliment we can get.</p>

<p>{{agentName}}<br>{{companyName}}<br>{{agentPhone}}</p>`,
      description: 'Sent 2-3 weeks after completion. Requests referrals.',
      isDefault: true,
      sortOrder: 10,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // ESTIMATE TEMPLATES
    templates.push({
      id: 'est_tpl_standard_roof',
      name: 'Standard Roof Replacement (20-30 SQ)',
      type: 'estimate',
      category: 'roofing',
      description: 'Complete shingle roof replacement for average residential home.',
      lineItems: [
        { name: 'Architectural Shingles (GAF Timberline HDZ)', unit: 'SQ', qty: 25, sellPrice: 165, costPrice: 95, section: 'Roofing Materials' },
        { name: 'Synthetic Underlayment (Ice & Water Shield)', unit: 'SQ', qty: 25, sellPrice: 45, costPrice: 22, section: 'Roofing Materials' },
        { name: 'Roof Flashing (Aluminum)', unit: 'LF', qty: 120, sellPrice: 12, costPrice: 5, section: 'Roofing Materials' },
        { name: 'Roof Vents & Ventilation', unit: 'EA', qty: 3, sellPrice: 75, costPrice: 30, section: 'Roofing Materials' },
        { name: 'Ridge Cap Shingles', unit: 'LF', qty: 100, sellPrice: 2.50, costPrice: 1.25, section: 'Roofing Materials' },
        { name: 'Debris Removal & Haul-Off', unit: 'LS', qty: 1, sellPrice: 450, costPrice: 250, section: 'Labor' },
        { name: 'Roof Tearoff (per SQ)', unit: 'SQ', qty: 25, sellPrice: 85, costPrice: 35, section: 'Labor' },
        { name: 'Underlayment Installation', unit: 'SQ', qty: 25, sellPrice: 35, costPrice: 15, section: 'Labor' },
        { name: 'Shingle Installation (per SQ)', unit: 'SQ', qty: 25, sellPrice: 105, costPrice: 45, section: 'Labor' },
        { name: 'Flashing & Trim Work', unit: 'LF', qty: 120, sellPrice: 8, costPrice: 3, section: 'Labor' },
        { name: 'Permits & Inspection', unit: 'LS', qty: 1, sellPrice: 350, costPrice: 150, section: 'Other' },
        { name: 'Roof Walkthrough & Final Inspection', unit: 'LS', qty: 1, sellPrice: 150, costPrice: 0, section: 'Labor' }
      ],
      trades: ['roofing'],
      notes: 'Includes 10-year workmanship warranty. Price assumes single-layer tearoff and standard residential pitch. Pricing valid 30 days. Site accessibility, difficult removal, or multiple layers add $500-1500.',
      isDefault: true,
      sortOrder: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    templates.push({
      id: 'est_tpl_premium_roof',
      name: 'Premium Roof Replacement (Designer Shingles)',
      type: 'estimate',
      category: 'roofing',
      description: 'High-end architectural roof replacement with premium materials.',
      lineItems: [
        { name: 'Premium Designer Shingles (GAF Timberline Ultra HD)', unit: 'SQ', qty: 25, sellPrice: 210, costPrice: 115, section: 'Roofing Materials' },
        { name: 'Premium Ice & Water Shield (entire deck)', unit: 'SQ', qty: 25, sellPrice: 65, costPrice: 30, section: 'Roofing Materials' },
        { name: 'Synthetic Underlayment (premium grade)', unit: 'SQ', qty: 25, sellPrice: 55, costPrice: 25, section: 'Roofing Materials' },
        { name: 'Copper/Galvanized Flashing (premium)', unit: 'LF', qty: 140, sellPrice: 18, costPrice: 8, section: 'Roofing Materials' },
        { name: 'Roof Ridge Vents (ventilation premium)', unit: 'LF', qty: 50, sellPrice: 8, costPrice: 3, section: 'Roofing Materials' },
        { name: 'Soffit & Fascia Integration', unit: 'LF', qty: 140, sellPrice: 15, costPrice: 6, section: 'Roofing Materials' },
        { name: 'Debris Removal & Haul-Off (premium)', unit: 'LS', qty: 1, sellPrice: 550, costPrice: 300, section: 'Labor' },
        { name: 'Roof Tearoff (per SQ)', unit: 'SQ', qty: 25, sellPrice: 95, costPrice: 40, section: 'Labor' },
        { name: 'Underlayment Installation (full coverage)', unit: 'SQ', qty: 25, sellPrice: 45, costPrice: 18, section: 'Labor' },
        { name: 'Shingle Installation (premium)', unit: 'SQ', qty: 25, sellPrice: 125, costPrice: 50, section: 'Labor' },
        { name: 'Flashing & Trim Work (premium)', unit: 'LF', qty: 140, sellPrice: 12, costPrice: 5, section: 'Labor' },
        { name: 'Permits & Inspection', unit: 'LS', qty: 1, sellPrice: 400, costPrice: 175, section: 'Other' },
        { name: 'Final Walkthrough & Warranty Review', unit: 'LS', qty: 1, sellPrice: 200, costPrice: 0, section: 'Labor' }
      ],
      trades: ['roofing'],
      notes: 'Premium materials throughout. Includes enhanced ventilation and ice/water shield for full protection. 15-year workmanship warranty. Valid 30 days.',
      isDefault: true,
      sortOrder: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    templates.push({
      id: 'est_tpl_roof_repair_minor',
      name: 'Minor Roof Repair',
      type: 'estimate',
      category: 'roofing',
      description: 'Spot repair, patch, or replacement of damaged shingles.',
      lineItems: [
        { name: 'Inspect & Identify Damage', unit: 'LS', qty: 1, sellPrice: 75, costPrice: 0, section: 'Labor' },
        { name: 'Shingle Replacement (per shingle)', unit: 'EA', qty: 8, sellPrice: 25, costPrice: 8, section: 'Materials' },
        { name: 'Sealant & Underlayment Patch', unit: 'LS', qty: 1, sellPrice: 85, costPrice: 25, section: 'Materials & Labor' },
        { name: 'Flashing Repair/Replacement', unit: 'LS', qty: 1, sellPrice: 150, costPrice: 60, section: 'Materials & Labor' },
        { name: 'Roof Cleanup & Cleanup', unit: 'LS', qty: 1, sellPrice: 75, costPrice: 25, section: 'Labor' }
      ],
      trades: ['roofing'],
      notes: 'Quick repair for storm damage or wear. 5-year warranty on repair work. Can usually be completed same day.',
      isDefault: true,
      sortOrder: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    templates.push({
      id: 'est_tpl_gutter_package',
      name: 'Seamless Gutter Package',
      type: 'estimate',
      category: 'gutters',
      description: 'Complete seamless gutter system with guards and downspouts.',
      lineItems: [
        { name: 'Seamless Gutters (6" Aluminum)', unit: 'LF', qty: 150, sellPrice: 18, costPrice: 7, section: 'Materials' },
        { name: 'Gutter Guards (Micro-Mesh)', unit: 'LF', qty: 150, sellPrice: 12, costPrice: 5, section: 'Materials' },
        { name: 'Downspouts (4" Aluminum)', unit: 'LF', qty: 60, sellPrice: 15, costPrice: 6, section: 'Materials' },
        { name: 'Downspout Extensions & Splash Blocks', unit: 'EA', qty: 6, sellPrice: 35, costPrice: 12, section: 'Materials' },
        { name: 'Brackets & Hardware', unit: 'LS', qty: 1, sellPrice: 150, costPrice: 50, section: 'Materials' },
        { name: 'Gutter Installation Labor', unit: 'LF', qty: 150, sellPrice: 8, costPrice: 3, section: 'Labor' },
        { name: 'Guard Installation Labor', unit: 'LF', qty: 150, sellPrice: 5, costPrice: 2, section: 'Labor' },
        { name: 'Site Cleanup & Debris Removal', unit: 'LS', qty: 1, sellPrice: 150, costPrice: 75, section: 'Labor' }
      ],
      trades: ['gutters'],
      notes: 'Seamless gutters custom-formed on-site. Prevents debris buildup. 10-year warranty. Installation typically 1-2 days.',
      isDefault: true,
      sortOrder: 4,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    templates.push({
      id: 'est_tpl_siding_package',
      name: 'Full Siding Replacement Package',
      type: 'estimate',
      category: 'siding',
      description: 'Complete siding, soffit, and fascia replacement.',
      lineItems: [
        { name: 'Fiber Cement Siding (premium, per SQ)', unit: 'SQ', qty: 45, sellPrice: 185, costPrice: 90, section: 'Materials' },
        { name: 'House Wrap & Moisture Barrier', unit: 'SQ', qty: 45, sellPrice: 8, costPrice: 3, section: 'Materials' },
        { name: 'Soffit (aluminum vented)', unit: 'LF', qty: 180, sellPrice: 14, costPrice: 6, section: 'Materials' },
        { name: 'Fascia (aluminum, matched)', unit: 'LF', qty: 180, sellPrice: 12, costPrice: 5, section: 'Materials' },
        { name: 'Trim & J-Channel', unit: 'LF', qty: 300, sellPrice: 5, costPrice: 2, section: 'Materials' },
        { name: 'Window & Door Casing', unit: 'EA', qty: 12, sellPrice: 45, costPrice: 18, section: 'Materials' },
        { name: 'Siding Removal & Prep', unit: 'SQ', qty: 45, sellPrice: 45, costPrice: 20, section: 'Labor' },
        { name: 'Siding Installation', unit: 'SQ', qty: 45, sellPrice: 95, costPrice: 40, section: 'Labor' },
        { name: 'Soffit & Fascia Installation', unit: 'LF', qty: 180, sellPrice: 12, costPrice: 5, section: 'Labor' },
        { name: 'Caulking & Sealant Work', unit: 'LF', qty: 300, sellPrice: 3, costPrice: 1, section: 'Labor' },
        { name: 'Permits & Inspection', unit: 'LS', qty: 1, sellPrice: 500, costPrice: 200, section: 'Other' },
        { name: 'Cleanup & Haul-Off', unit: 'LS', qty: 1, sellPrice: 450, costPrice: 200, section: 'Labor' }
      ],
      trades: ['siding'],
      notes: '25-year siding warranty. Improves curb appeal and home value. Typical install 1-2 weeks.',
      isDefault: true,
      sortOrder: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // CONTRACT TEMPLATES
    templates.push({
      id: 'con_tpl_roofing_standard',
      name: 'Standard Roofing Contract',
      type: 'contract',
      category: 'roofing',
      description: 'Standard residential roofing contract with warranty terms.',
      content: `RESIDENTIAL ROOFING SERVICE AGREEMENT

THIS AGREEMENT made and entered into this _____ day of ________________, 20_____, by and between NBD PRO, LLC, a licensed contractor ("Contractor"), and {{firstName}} {{lastName}}, a property owner ("Homeowner").

WHEREAS, Homeowner desires to have certain roofing work performed on the property located at {{address}}, {{city}}, {{state}} {{zip}} ("Property"); and

WHEREAS, Contractor is willing to perform such work in accordance with the terms and conditions herein contained.

NOW, THEREFORE, in consideration of the mutual covenants and agreements herein contained, it is agreed as follows:

1. SCOPE OF WORK
Contractor agrees to provide the following roofing services:
{{scopeOfWork}}

The work shall include all labor, materials, permits, inspections, and cleanup necessary to complete the project in a professional and workmanlike manner.

2. CONTRACT PRICE AND PAYMENT TERMS
The total contract price for the work described herein shall be {{totalPrice}}, plus applicable taxes.

Payment Terms: {{paymentTerms}}

Payment methods accepted: Check, ACH transfer, or credit card.

3. PROJECT TIMELINE
Start Date: {{startDate}}
Estimated Completion Date: {{completionDate}}

Contractor shall use reasonable efforts to complete the work by the estimated completion date. Delays due to weather, material availability, permit delays, or unforeseen conditions shall extend the timeline accordingly.

4. WARRANTY
Contractor warrants that all work shall be performed in a professional and workmanlike manner in accordance with industry standards.

a) Workmanship Warranty: Contractor warrants all labor and installation for a period of ten (10) years from date of completion. This warranty covers leaks, improper installation, or defects in workmanship.

b) Materials Warranty: All roofing materials (shingles, flashing, underlayment) carry manufacturer warranties as specified by the manufacturer. Typical shingle warranties are 20-30 years for material defects.

c) Warranty Conditions: Warranty is valid only if:
   - Homeowner has maintained the roof in accordance with maintenance guidelines provided
   - No unauthorized alterations or repairs have been made
   - Homeowner has maintained proper ventilation and drainage

5. CHANGE ORDERS
Any changes to the scope of work must be requested in writing and approved by both parties prior to work commencing. A written change order shall specify the nature of the change, any cost adjustments, and time extensions.

6. HOMEOWNER RESPONSIBILITIES
Homeowner agrees to:
- Provide safe and unobstructed access to the work area
- Move vehicles from driveway when work is scheduled to begin
- Keep children and pets away from the work area for safety
- Notify Contractor of any concerns or changes needed
- Make payment according to the terms specified herein

7. CONTRACTOR RESPONSIBILITIES
Contractor agrees to:
- Perform all work in a professional and timely manner
- Maintain a clean and safe work site
- Protect Homeowner's property from damage during installation
- Obtain all required permits and licenses
- Conduct final inspection with Homeowner upon completion
- Provide warranty documentation and maintenance guidelines

8. INSURANCE AND LIABILITY
Contractor maintains workers' compensation insurance and general liability insurance. Homeowner is not responsible for any injuries to Contractor's employees or damage to Contractor's equipment.

9. PERMITS AND INSPECTIONS
Contractor shall be responsible for obtaining all necessary permits and scheduling required inspections. Permit costs are included in the contract price. Homeowner shall cooperate with inspectors and Contractor as needed.

10. CLEANUP AND DEBRIS REMOVAL
Contractor shall remove all debris and scrap materials from the work site on a daily basis. Final cleanup shall occur upon completion of the project.

11. CANCELLATION POLICY
If Homeowner cancels this agreement in writing more than 7 days prior to the scheduled start date, Contractor shall refund any deposits minus materials ordered ($______). Cancellation within 7 days of start date or after work has commenced forfeits all deposits.

12. INSURANCE CLAIMS AND ASSIGNMENTS
If this work is being performed as part of an insurance claim, Homeowner assigns all claim benefits to Contractor to the extent of the contract price. Homeowner authorizes Contractor to communicate directly with the insurance company and adjuster regarding the work performed and any supplements.

13. DISPUTE RESOLUTION
Any disputes arising from this agreement shall be resolved through good-faith negotiation. If negotiation fails, disputes may be submitted to mediation or binding arbitration.

14. ENTIRE AGREEMENT
This agreement constitutes the entire agreement between the parties and supersedes all prior negotiations, representations, and agreements.

15. AUTHORIZATION
Homeowner authorizes {{agentName}} to represent Contractor in all matters relating to this project, including communication with insurance companies.

HOMEOWNER AGREES TO THE TERMS AND CONDITIONS ABOVE:

Homeowner Signature: _____________________________ Date: __________
Homeowner Name (print): __________________________

Homeowner Signature: _____________________________ Date: __________
Homeowner Name (print): __________________________


CONTRACTOR AGREES TO THE TERMS AND CONDITIONS ABOVE:

Contractor Signature: _____________________________ Date: __________
Contractor Title: ________________________________

NBD PRO, LLC
License #: [State License]
Phone: {{agentPhone}}
Email: {{agentEmail}}`,
      fields: ['homeownerName', 'address', 'scopeOfWork', 'totalPrice', 'startDate', 'completionDate', 'paymentTerms'],
      isDefault: true,
      sortOrder: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    templates.push({
      id: 'con_tpl_insurance_restoration',
      name: 'Insurance Restoration Contract',
      type: 'contract',
      category: 'roofing',
      description: 'Insurance restoration contract with assignment of benefits.',
      content: `INSURANCE RESTORATION SERVICE AGREEMENT & ASSIGNMENT OF BENEFITS

THIS AGREEMENT made and entered into this _____ day of ________________, 20_____, by and between NBD PRO, LLC ("Contractor"), and {{firstName}} {{lastName}} ("Homeowner"), and _________________ Insurance Company ("Insurance Company").

PROPERTY ADDRESS: {{address}}, {{city}}, {{state}} {{zip}}
CLAIM NUMBER: {{claimNumber}}
INSURANCE COMPANY: _________________________________

1. ASSIGNMENT OF BENEFITS
Homeowner hereby assigns all claim benefits under their insurance policy relating to the above-referenced claim to Contractor, to the extent of the reasonable cost of repair as determined by Contractor's estimate. This assignment is made to secure payment to Contractor for services rendered.

Homeowner authorizes Contractor to:
- Communicate directly with the insurance adjuster and company
- Obtain all information relating to the claim
- Submit estimates and supplements for the claimed damage
- Represent Homeowner's interests in all claim-related matters
- Accept payment directly from the insurance company

2. SCOPE OF WORK
Contractor shall perform the following restoration work based on the insurance adjuster's report and Contractor's assessment:

{{scopeOfWork}}

All work shall be performed in accordance with industry standards and local building codes.

3. CONTRACT PRICE
The contract price is {{totalPrice}}, which represents Contractor's detailed estimate for the scope of work described above.

This estimate is based on current material costs and labor rates. The final cost may adjust based on:
- Insurance company approval of supplements
- Unforeseen damage discovered during removal
- Material cost increases between estimate and completion

4. PAYMENT STRUCTURE
Homeowner's financial responsibility is limited to:
- The insurance deductible: $__________
- Any amount above the insurance company's approval: $__________
- Homeowner's co-insurance if applicable: $__________

Payment terms: 50% deposit upon signing, balance due upon completion or as insurance payment is received.

If the insurance company approves more than the original estimate, Contractor will notify Homeowner of the additional approved amount. Homeowner may choose to proceed with additional work at no additional cost (covered by insurance) or request a refund.

5. SUPPLEMENTS AND CHANGE ORDERS
If additional damage is discovered during the course of work, Contractor shall prepare a written supplement detailing the additional work and cost. This supplement shall be submitted to the insurance company for approval before work proceeds.

Additional work discovered shall NOT be performed without written approval from either the insurance company or Homeowner, with understanding of who will pay for the additional work.

6. TIMELINE
Start Date: {{startDate}}
Estimated Completion Date: {{completionDate}}

Timeline may be extended due to:
- Insurance company delays in approval
- Material delivery delays
- Unforeseen damage discovery
- Weather conditions

7. WARRANTY
Contractor warrants all work for a period of ten (10) years from completion. This warranty covers defects in workmanship and material installation. Homeowner may transfer this warranty to a future buyer of the property.

Material warranties are provided by manufacturers as per their terms (typically 20-30 years for roofing materials).

8. HOMEOWNER COOPERATION
Homeowner agrees to:
- Sign all necessary insurance documents and authorizations
- Allow Contractor access to the property for work
- Not make repairs or changes without Contractor's approval
- Cooperate with the insurance adjuster
- Notify Contractor of any insurance company communications

9. INSURANCE COMPANY APPROVAL
This contract is contingent upon the insurance company approving the estimated cost of repair. If the insurance company denies the claim or approves for less than the contract price, the parties may:
a) Adjust the scope of work to match insurance approval
b) Homeowner pays the difference to proceed with full scope
c) Terminate the contract with refund of deposits

10. DEBRIS REMOVAL AND CLEANUP
Contractor shall remove all debris and old materials from the property and properly dispose of them. Final cleanup shall be performed upon completion of all work.

11. PERMITS AND INSPECTIONS
Contractor shall obtain all necessary permits and arrange for required inspections. Permit costs are included in the contract price. Homeowner shall make the property available for inspections as required.

12. LIEN RIGHTS
Contractor retains all lien rights under state law if payment is not received. Homeowner understands that Contractor may file a mechanic's lien against the property if payment is not received within thirty (30) days of project completion.

Homeowner agrees to ensure the insurance company pays Contractor directly or will personally guarantee payment to Contractor.

13. TERMINATION
Either party may terminate this agreement in writing if:
- Insurance company denies or significantly reduces the claim
- Material damage or conditions make the work impractical
- Homeowner is unable or unwilling to proceed

Upon termination, Contractor shall be paid for all work completed to date plus any ordered materials and costs incurred.

14. DISPUTE RESOLUTION
Any disputes regarding insurance claim interpretation or work scope shall be resolved by the insurance adjuster's determination. If disputes persist, the parties agree to binding arbitration.

15. ENTIRE AGREEMENT
This agreement constitutes the entire agreement between the parties and supersedes all prior agreements and negotiations.

SIGNATURES:

HOMEOWNER:

Signature: _____________________________ Date: __________
Print Name: __________________________


Spouse/Co-Owner (if applicable):

Signature: _____________________________ Date: __________
Print Name: __________________________


CONTRACTOR:

By: __________________________________
Name: ________________________________
Title: ________________________________
Date: __________
NBD PRO, LLC License #: _______________`,
      fields: ['homeownerName', 'address', 'claimNumber', 'scopeOfWork', 'totalPrice', 'startDate', 'completionDate'],
      isDefault: true,
      sortOrder: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // SCOPE OF WORK TEMPLATES
    templates.push({
      id: 'sow_tpl_roof_replacement',
      name: 'Roof Replacement Scope of Work',
      type: 'scope_of_work',
      category: 'roofing',
      content: `SCOPE OF WORK – ROOF REPLACEMENT

PROJECT: Complete Residential Roof Replacement
PROPERTY: {{address}}, {{city}}, {{state}} {{zip}}
CONTRACTOR: NBD Pro, LLC
HOMEOWNER: {{firstName}} {{lastName}}

1. REMOVAL & DEMOLITION
- Remove existing roofing materials including shingles, nails, and debris from entire roof surface
- Inspect roof decking for damage, dry rot, or structural issues
- Replace any damaged decking with matching material (additional cost if required)
- Remove and properly dispose of all old roofing materials off-site
- Install protective tarps if weather threatens during work

2. UNDERLAYMENT & WEATHERPROOFING
- Install synthetic underlayment meeting current building codes (minimum 30# felt equivalent)
- Apply ice & water shield along all eaves (minimum 3 feet), valleys, and areas requiring extra protection
- Ensure proper overlap and fastening per manufacturer specifications
- Inspect for any holes or damage to underlayment

3. FLASHING & TRIM
- Install new aluminum flashing around all roof penetrations (vents, chimney, skylights)
- Install or replace roof-to-wall flashing
- Install or replace step flashing at all side walls
- Ensure all flashing is properly sealed and caulked to prevent water intrusion
- Install ridge cap flashing if applicable

4. ROOFING MATERIALS
- Install new architectural shingles meeting or exceeding [SPECIFY GRADE] rating
- Shingles shall be [SPECIFY COLOR AND BRAND], 3-tab or architectural grade with windstorm rating
- Install shingles per manufacturer specifications with proper fastening and spacing
- Ensure proper alignment and overlap on all shingles
- Apply starter shingles along all roof edges

5. ROOF VENTS & VENTILATION
- Install or replace roof vents as required by code and existing structure
- Install ridge vents for proper attic ventilation (if applicable)
- Ensure all vents are properly flashed and sealed
- Verify ventilation is functioning and unobstructed

6. GUTTERS & DOWNSPOUTS (if included)
- Install seamless gutters (specify type and size)
- Install downspouts with proper slope and extensions
- Ensure gutters drain away from foundation
- Install gutter guards (if included)

7. CLEANUP & SITE RESTORATION
- Remove all debris, nails, and roofing materials from property daily
- Sweep and clean entire roof surface with broom
- Remove tarps and protect from debris
- Inspect property for any debris or damage
- Perform final walkthrough with homeowner

8. FINAL INSPECTION & WARRANTY
- Conduct final roof inspection for proper installation and no leaks
- Walk roof with homeowner to inspect workmanship
- Provide manufacturer material warranty documentation
- Provide NBD Pro 10-year workmanship warranty documentation
- Provide maintenance guidelines and care instructions

9. NOT INCLUDED IN SCOPE
- Structural repairs beyond replacing damaged decking
- Interior water damage repair or remediation
- Painting or additional exterior work
- Chimney repair or restoration
- Skylight repair or replacement
- Gutter cleaning or debris removal beyond normal renovation cleanup

10. TIMELINE
Estimated duration: 2-3 days for single-story home, 3-4 days for multi-story, weather permitting.

11. WARRANTIES
- Workmanship: 10 years on all installation
- Materials: Per manufacturer (typically 25-30 years on shingles)
- Workmanship warranty is transferable if property is sold`,
      sections: ['Removal & Demolition', 'Underlayment & Weatherproofing', 'Flashing & Trim', 'Roofing Materials', 'Roof Vents & Ventilation', 'Cleanup & Site Restoration', 'Final Inspection & Warranty'],
      isDefault: true,
      sortOrder: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    templates.push({
      id: 'sow_tpl_storm_damage',
      name: 'Storm Damage Insurance Scope of Work',
      type: 'scope_of_work',
      category: 'roofing',
      content: `SCOPE OF WORK – INSURANCE CLAIM RESTORATION

PROJECT: Storm Damage Restoration (Insurance Claim)
CLAIM NUMBER: {{claimNumber}}
PROPERTY: {{address}}, {{city}}, {{state}} {{zip}}
ADJUSTER: _________________________ DATE OF LOSS: ______________

1. ROOF DAMAGE ASSESSMENT
- Identify all areas of roof affected by storm damage
- Document impact damage, missing shingles, and structural issues
- Photograph all damaged areas for insurance documentation
- Measure affected areas in square feet for material calculation
- Inspect underlying decking for damage

2. ROOF REPAIR/REPLACEMENT
- Remove damaged shingles and roofing materials from affected areas
- Replace with matching architectural shingles, color: ____________
- Install new underlayment in affected areas
- Replace or repair flashing as needed
- Ensure repair blends seamlessly with existing roof

3. GUTTER DAMAGE REPAIR (if applicable)
- Assess gutter damage from storm (dents, separation, etc.)
- Replace damaged gutter sections with seamless gutter matching existing profile
- Reattach or replace downspouts
- Ensure proper drainage

4. SIDING/SOFFIT DAMAGE REPAIR (if applicable)
- Replace damaged siding panels matching existing profile and color
- Repair or replace soffit/fascia as needed
- Caulk and seal any gaps or penetrations
- Paint or stain to match existing (if required)

5. DEBRIS REMOVAL
- Remove all storm debris from property (branches, shingles, etc.)
- Clean gutters of debris from storm damage
- Haul off all roofing waste and debris
- Perform final property cleanup

6. MATERIALS SPECIFICATIONS
- Shingles: [Brand/Grade as per insurance adjuster approval]
- Underlayment: [Synthetic per adjuster specifications]
- Flashing: [Aluminum or galvanized per original]
- Siding: [Matching existing materials and profile]

7. INSURANCE COMPLIANCE
- All work performed per insurance adjuster's scope of damage assessment
- All materials meet or exceed insurance adjuster specifications
- Work shall be completed in accordance with insurance company requirements
- Contractor shall provide detailed invoices for all materials and labor
- Contractor shall submit supplements if additional damage is discovered

8. QUALITY STANDARDS
- All work performed to current building code standards
- All work performed in professional, workmanlike manner
- Repairs shall blend with existing roof/exterior
- No visible patching or repair marks
- Warranty: 10 years on workmanship, per manufacturer on materials

9. TIMELINE
Estimated start date: {{startDate}}
Estimated completion: {{completionDate}}
(Timeline subject to material delivery and insurance approval delays)

10. CHANGE ORDERS
Any additional damage discovered during work shall be documented and submitted as a supplemental claim to the insurance company before work proceeds.

11. WARRANTY
- Workmanship: 10 years from completion
- Materials: Per manufacturer warranty as per insurance approval
- Any defects in workmanship shall be corrected at no charge during warranty period`,
      sections: ['Roof Damage Assessment', 'Roof Repair/Replacement', 'Gutter Damage Repair', 'Debris Removal', 'Materials Specifications', 'Insurance Compliance', 'Quality Standards'],
      isDefault: true,
      sortOrder: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // FOLLOW-UP SEQUENCES
    templates.push({
      id: 'seq_new_lead_nurture',
      name: 'New Lead Nurture Sequence',
      type: 'sequence',
      category: 'sales',
      description: 'Automated follow-up for new leads who haven\'t scheduled inspection.',
      steps: [
        { day: 0, action: 'email', templateId: 'etpl_initial_contact', subject: 'Welcome — Free Roof Inspection' },
        { day: 0, action: 'task', description: 'Create lead record, assign to {{agentName}}, set follow-up reminder' },
        { day: 1, action: 'task', description: 'Call lead — introduce yourself, confirm receipt of email, answer questions' },
        { day: 3, action: 'email', templateId: 'etpl_initial_contact', subject: 'Quick question: What\'s your roof\'s biggest challenge?' },
        { day: 5, action: 'task', description: 'Follow-up call: Ask about timing for free inspection, address objections' },
        { day: 7, action: 'email', templateId: 'etpl_initial_contact', subject: 'Still interested in protecting your roof?' },
        { day: 14, action: 'email', templateId: 'etpl_initial_contact', subject: 'Your free inspection expires tomorrow' },
        { day: 21, action: 'task', description: 'Final call: Offer to schedule inspection immediately or move to inactive' }
      ],
      isDefault: true,
      isActive: true,
      sortOrder: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    templates.push({
      id: 'seq_post_inspection_close',
      name: 'Post-Inspection Close Sequence',
      type: 'sequence',
      category: 'sales',
      description: 'Aggressive follow-up sequence to close sale after inspection.',
      steps: [
        { day: 0, action: 'email', templateId: 'etpl_post_inspection', subject: 'Your inspection results (inside)' },
        { day: 1, action: 'task', description: 'Call to review findings, answer questions, gauge buying interest' },
        { day: 3, action: 'email', templateId: 'etpl_post_inspection', subject: 'Quick follow-up on your roof inspection' },
        { day: 3, action: 'task', description: 'Send estimate via email, ask when they can review it' },
        { day: 5, action: 'task', description: 'Call to discuss estimate, financing options, timeline to decision' },
        { day: 7, action: 'email', templateId: 'etpl_post_inspection', subject: 'Let\'s lock in your new roof' },
        { day: 10, action: 'task', description: 'Final call: Present contract, ask for decision, offer limited incentive if needed' }
      ],
      isDefault: true,
      isActive: true,
      sortOrder: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    templates.push({
      id: 'seq_post_job_reviews',
      name: 'Post-Job Review & Referral Sequence',
      type: 'sequence',
      category: 'follow_up',
      description: 'Collect reviews and referrals after project completion.',
      steps: [
        { day: 7, action: 'email', templateId: 'etpl_review_request', subject: 'We\'d love your feedback' },
        { day: 14, action: 'task', description: 'Call to thank them, ask if they\'re happy, encourage review' },
        { day: 21, action: 'email', templateId: 'etpl_referral_ask', subject: 'Know someone who needs a roof?' },
        { day: 30, action: 'task', description: 'Follow-up on referrals, ask if they know anyone else' },
        { day: 60, action: 'task', description: 'Check-in call: 60-day roof check, ask about performance' },
        { day: 365, action: 'task', description: 'Annual check-in: Schedule 1-year inspection, offer annual maintenance program' }
      ],
      isDefault: true,
      isActive: true,
      sortOrder: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    saveToStorage();
  }

  // ============================================================================
  // UI RENDERING
  // ============================================================================

  function renderTemplateLibrary() {
    const container = document.getElementById('template-library-container') || createContainer();

    let html = `
      <div style="padding: 20px; background: white;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h1 style="margin: 0; color: var(--orange);">Template Library</h1>
          <button onclick="window.NBDTemplateSuite.openNewTemplateModal()"
            style="padding: 10px 20px; background: var(--orange); color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
            + Add Template
          </button>
        </div>

        <div style="display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap;">
          <input type="text" id="template-search" placeholder="Search templates..."
            style="flex: 1; min-width: 200px; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px;"
            onkeyup="window.NBDTemplateSuite.performSearch(this.value)">
          <select id="template-type-filter" style="padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px;"
            onchange="window.NBDTemplateSuite.filterByType(this.value)">
            <option value="">All Types</option>
            <option value="email">Email</option>
            <option value="estimate">Estimate</option>
            <option value="contract">Contract</option>
            <option value="scope_of_work">Scope of Work</option>
            <option value="sequence">Sequence</option>
          </select>
        </div>

        <div id="template-stats" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 20px;">
          ${['email', 'estimate', 'contract', 'scope_of_work', 'sequence'].map(type => {
            const count = templates.filter(t => t.type === type).length;
            return `
              <div style="background: #f5f5f5; padding: 15px; border-radius: 4px; text-align: center;">
                <div style="font-size: 24px; font-weight: bold; color: ${TYPE_COLORS[type]}">${count}</div>
                <div style="font-size: 12px; color: #666; margin-top: 5px;">${type.replace('_', ' ').toUpperCase()}</div>
              </div>
            `;
          }).join('')}
        </div>

        <div id="template-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 15px;">
          ${templates.map(tpl => renderTemplateCard(tpl)).join('')}
        </div>
      </div>
    `;

    container.innerHTML = html;
    return container;
  }

  function renderTemplateCard(tpl) {
    const lastUsed = tpl.lastUsedAt ? new Date(tpl.lastUsedAt).toLocaleDateString() : 'Never';
    const preview = tpl.body ? tpl.body.substring(0, 100) : tpl.content ? tpl.content.substring(0, 100) : tpl.subject || '(No content)';

    return `
      <div style="border: 1px solid #ddd; border-radius: 8px; padding: 15px; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
          <div>
            <h3 style="margin: 0 0 5px 0; color: #333;">${tpl.name}</h3>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <span style="background: ${TYPE_COLORS[tpl.type]}; color: white; padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: bold;">
                ${tpl.type.replace('_', ' ').toUpperCase()}
              </span>
              ${tpl.category ? `<span style="background: #e0e0e0; color: #333; padding: 2px 8px; border-radius: 3px; font-size: 11px;">${tpl.category}</span>` : ''}
              ${tpl.isDefault ? `<span style="background: #4CAF50; color: white; padding: 2px 8px; border-radius: 3px; font-size: 11px;">DEFAULT</span>` : ''}
            </div>
          </div>
          <button onclick="window.NBDTemplateSuite.deleteTemplate('${tpl.id}')"
            style="background: #f44336; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: 12px;">
            Delete
          </button>
        </div>

        <p style="color: #666; font-size: 13px; margin: 10px 0; line-height: 1.4; min-height: 50px;">
          ${tpl.description || preview.substring(0, 80) + '...'}
        </p>

        <div style="display: flex; justify-content: space-between; font-size: 12px; color: #999; margin-bottom: 10px;">
          <span>Used: ${tpl.useCount || 0} times</span>
          <span>Last: ${lastUsed}</span>
        </div>

        <div style="display: flex; gap: 8px;">
          <button onclick="window.NBDTemplateSuite.openTemplateEditor('${tpl.id}')"
            style="flex: 1; background: var(--orange); color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer; font-weight: bold;">
            Edit
          </button>
          <button onclick="window.NBDTemplateSuite.duplicateTemplate('${tpl.id}')"
            style="flex: 1; background: #2196F3; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer;">
            Duplicate
          </button>
          <button onclick="window.NBDTemplateSuite.previewTemplate('${tpl.id}')"
            style="flex: 1; background: #9C27B0; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer;">
            Preview
          </button>
        </div>
      </div>
    `;
  }

  function openTemplateEditor(id) {
    const tpl = getTemplate(id) || { type: 'email', category: '', isActive: true };
    currentTemplate = { ...tpl };

    const modal = document.createElement('div');
    modal.id = 'template-editor-modal';
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center; z-index: 10000;
    `;

    let formHTML = `
      <div style="background: white; padding: 20px; border-radius: 8px; width: 90%; max-width: 900px; max-height: 90vh; overflow-y: auto; box-shadow: 0 4px 6px rgba(0,0,0,0.2);">
        <h2 style="margin-top: 0; color: var(--orange);">${id ? 'Edit Template' : 'New Template'}</h2>

        <div style="margin-bottom: 15px;">
          <label style="display: block; font-weight: bold; margin-bottom: 5px;">Template Name *</label>
          <input type="text" id="tpl-name" value="${tpl.name || ''}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
        </div>

        <div style="margin-bottom: 15px;">
          <label style="display: block; font-weight: bold; margin-bottom: 5px;">Template Type *</label>
          <select id="tpl-type" ${id ? 'disabled' : ''} style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
            <option value="email" ${tpl.type === 'email' ? 'selected' : ''}>Email</option>
            <option value="estimate" ${tpl.type === 'estimate' ? 'selected' : ''}>Estimate</option>
            <option value="contract" ${tpl.type === 'contract' ? 'selected' : ''}>Contract</option>
            <option value="scope_of_work" ${tpl.type === 'scope_of_work' ? 'selected' : ''}>Scope of Work</option>
            <option value="sequence" ${tpl.type === 'sequence' ? 'selected' : ''}>Follow-up Sequence</option>
          </select>
        </div>

        <div style="margin-bottom: 15px;">
          <label style="display: block; font-weight: bold; margin-bottom: 5px;">Category</label>
          <input type="text" id="tpl-category" value="${tpl.category || ''}" placeholder="e.g., insurance_pipeline, general" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
        </div>

        <div style="margin-bottom: 15px;">
          <label style="display: block; font-weight: bold; margin-bottom: 5px;">Description</label>
          <textarea id="tpl-description" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; height: 60px;">${tpl.description || ''}</textarea>
        </div>
    `;

    if (tpl.type === 'email') {
      formHTML += `
        <div style="margin-bottom: 15px;">
          <label style="display: block; font-weight: bold; margin-bottom: 5px;">Email Subject *</label>
          <input type="text" id="tpl-subject" value="${tpl.subject || ''}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
        </div>

        <div style="margin-bottom: 15px;">
          <label style="display: block; font-weight: bold; margin-bottom: 5px;">Email Body *</label>
          <div style="display: flex; gap: 10px; margin-bottom: 10px;">
            <button type="button" onclick="window.NBDTemplateSuite.insertMergeField('firstName', 'tpl-body')" style="padding: 5px 10px; background: #2196F3; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;">Insert {{firstName}}</button>
            <button type="button" onclick="window.NBDTemplateSuite.insertMergeField('lastName', 'tpl-body')" style="padding: 5px 10px; background: #2196F3; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;">Insert {{lastName}}</button>
            <button type="button" onclick="window.NBDTemplateSuite.insertMergeField('address', 'tpl-body')" style="padding: 5px 10px; background: #2196F3; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;">Insert {{address}}</button>
          </div>
          <textarea id="tpl-body" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; height: 250px; font-family: monospace; font-size: 12px;">${tpl.body || ''}</textarea>
        </div>

        <div style="margin-bottom: 15px;">
          <label style="display: block; font-weight: bold; margin-bottom: 5px;">
            <input type="checkbox" id="tpl-is-default" ${tpl.isDefault ? 'checked' : ''} style="margin-right: 5px;">
            Set as Default Template
          </label>
        </div>
      `;
    } else if (tpl.type === 'contract') {
      formHTML += `
        <div style="margin-bottom: 15px;">
          <label style="display: block; font-weight: bold; margin-bottom: 5px;">Contract Content *</label>
          <textarea id="tpl-content" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; height: 300px; font-family: monospace; font-size: 12px;">${tpl.content || ''}</textarea>
        </div>
      `;
    } else if (tpl.type === 'scope_of_work') {
      formHTML += `
        <div style="margin-bottom: 15px;">
          <label style="display: block; font-weight: bold; margin-bottom: 5px;">Scope of Work Content *</label>
          <textarea id="tpl-content" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; height: 300px; font-family: monospace; font-size: 12px;">${tpl.content || ''}</textarea>
        </div>
      `;
    }

    formHTML += `
      <div style="display: flex; gap: 10px; margin-top: 20px;">
        <button onclick="window.NBDTemplateSuite.saveTemplate()"
          style="flex: 1; padding: 10px; background: var(--orange); color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px;">
          Save Template
        </button>
        <button onclick="window.NBDTemplateSuite.closeTemplateEditor()"
          style="flex: 1; padding: 10px; background: #ddd; color: #333; border: none; border-radius: 4px; cursor: pointer;">
          Cancel
        </button>
      </div>
      </div>
    `;

    modal.innerHTML = formHTML;
    document.body.appendChild(modal);
    editorModal = modal;

    modal.onclick = (e) => {
      if (e.target === modal) window.NBDTemplateSuite.closeTemplateEditor();
    };
  }

  function openNewTemplateModal() {
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center; z-index: 10000;
    `;

    modal.innerHTML = `
      <div style="background: white; padding: 30px; border-radius: 8px; text-align: center;">
        <h2 style="margin-top: 0; color: var(--orange);">Choose Template Type</h2>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px;">
          <button onclick="window.NBDTemplateSuite.openTemplateEditor(); this.closest('div').parentElement.remove();"
            style="padding: 15px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Email</button>
          <button onclick="window.NBDTemplateSuite.openTemplateEditor(); this.closest('div').parentElement.remove();"
            style="padding: 15px; background: #FF9800; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Estimate</button>
          <button onclick="window.NBDTemplateSuite.openTemplateEditor(); this.closest('div').parentElement.remove();"
            style="padding: 15px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Contract</button>
          <button onclick="window.NBDTemplateSuite.openTemplateEditor(); this.closest('div').parentElement.remove();"
            style="padding: 15px; background: #9C27B0; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">SOW</button>
          <button onclick="window.NBDTemplateSuite.openTemplateEditor(); this.closest('div').parentElement.remove();"
            style="padding: 15px; background: #00BCD4; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Sequence</button>
        </div>
        <button onclick="this.parentElement.parentElement.remove()"
          style="margin-top: 15px; padding: 10px 20px; background: #ddd; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>
      </div>
    `;

    document.body.appendChild(modal);
    modal.onclick = (e) => {
      if (e.target === modal) modal.remove();
    };
  }

  function saveTemplate() {
    const name = document.getElementById('tpl-name')?.value;
    const type = document.getElementById('tpl-type')?.value;
    const category = document.getElementById('tpl-category')?.value;
    const description = document.getElementById('tpl-description')?.value;

    if (!name || !type) {
      window._showToast?.('Name and Type are required');
      return;
    }

    const data = {
      name,
      type,
      category,
      description
    };

    if (type === 'email') {
      data.subject = document.getElementById('tpl-subject')?.value || '';
      data.body = document.getElementById('tpl-body')?.value || '';
      data.isDefault = document.getElementById('tpl-is-default')?.checked || false;
    } else if (type === 'contract' || type === 'scope_of_work') {
      data.content = document.getElementById('tpl-content')?.value || '';
    }

    if (currentTemplate.id) {
      updateTemplate(currentTemplate.id, data);
    } else {
      createTemplate(data);
    }

    closeTemplateEditor();
    renderTemplateLibrary();
  }

  function closeTemplateEditor() {
    editorModal?.remove();
    currentTemplate = null;
  }

  function previewTemplate(id) {
    const tpl = getTemplate(id);
    if (!tpl) return;

    const preview = previewWithSampleData(tpl);
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center; z-index: 10000;
    `;

    modal.innerHTML = `
      <div style="background: white; padding: 20px; border-radius: 8px; width: 90%; max-width: 800px; max-height: 90vh; overflow-y: auto;">
        <h2 style="margin-top: 0; color: var(--orange);">${tpl.name} — Preview</h2>
        <div style="border: 1px solid #ddd; padding: 15px; border-radius: 4px; background: #f9f9f9; white-space: pre-wrap; font-family: monospace; font-size: 12px; line-height: 1.5;">
          ${escapeHtml(preview)}
        </div>
        <button onclick="this.parentElement.parentElement.remove()"
          style="margin-top: 15px; padding: 10px 20px; background: var(--orange); color: white; border: none; border-radius: 4px; cursor: pointer;">
          Close Preview
        </button>
      </div>
    `;

    document.body.appendChild(modal);
    modal.onclick = (e) => {
      if (e.target === modal) modal.remove();
    };
  }

  function performSearch(query) {
    const results = searchTemplates(query);
    const container = document.getElementById('template-grid');
    if (container) {
      container.innerHTML = results.map(tpl => renderTemplateCard(tpl)).join('');
    }
  }

  function filterByType(type) {
    const container = document.getElementById('template-grid');
    if (!container) return;

    const filtered = type ? getTemplatesByType(type) : getAllTemplates();
    container.innerHTML = filtered.map(tpl => renderTemplateCard(tpl)).join('');
  }

  function createContainer() {
    const container = document.createElement('div');
    container.id = 'template-library-container';
    document.body.appendChild(container);
    return container;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================================================
  // EXPORT/IMPORT
  // ============================================================================

  function exportTemplatesJSON() {
    const dataStr = JSON.stringify(templates, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nbd-templates-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importTemplatesJSON(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        if (!Array.isArray(imported)) {
          window._showToast?.('Invalid file format');
          return;
        }

        let added = 0;
        imported.forEach(tpl => {
          const exists = templates.find(t => t.id === tpl.id);
          if (!exists) {
            templates.push(tpl);
            added++;
          }
        });

        saveToStorage();
        window._showToast?.(`Imported ${added} new templates`);
      } catch (err) {
        window._showToast?.('Failed to import templates');
      }
    };
    reader.readAsText(file);
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  function exposePublicAPI() {
    window.NBDTemplateSuite = {
      // Core CRUD
      createTemplate,
      updateTemplate,
      deleteTemplate,
      duplicateTemplate,
      getTemplate,
      getAllTemplates,
      getTemplatesByType,
      getTemplatesByCategory,
      searchTemplates,
      recordTemplateUsage,

      // Merge fields
      getAvailableMergeFields,
      insertMergeField,
      previewWithSampleData,

      // UI
      renderTemplateLibrary,
      openTemplateEditor,
      openNewTemplateModal,
      saveTemplate,
      closeTemplateEditor,
      previewTemplate,
      performSearch,
      filterByType,

      // Import/Export
      exportTemplatesJSON,
      importTemplatesJSON,

      // Initialization
      initializeSuite
    };
  }

  // Initialize on load
  return {
    init: initializeSuite,
    initialize: initializeSuite
  };
})();

// Auto-initialize when module loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => NBDTemplateSuite.init());
} else {
  NBDTemplateSuite.init();
}
