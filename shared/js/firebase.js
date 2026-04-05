/**
 * NBD Platform — Shared Firebase Module
 * Single source of truth for Firebase initialization
 * Exposes all Firebase functions to window scope (proven pattern)
 */

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBEonomNwd5n4TXm1rUCNqIm-w0HjdqOAI",
  authDomain: "nobigdealwithjoedeal-com.firebaseapp.com",
  projectId: "nobigdealwithjoedeal-com",
  storageBucket: "nobigdealwithjoedeal-com.firebasestorage.app",
  messagingSenderId: "585035625093",
  appId: "1:585035625093:web:5d8f7f1dcdcf6b5b7f3d6a",
  measurementId: "G-XXXXXXXXXX"
};

// Initialize Firebase
let app, auth, db, storage;

function initFirebase() {
  if (!firebase || !firebase.apps || firebase.apps.length === 0) {
    app = firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    storage = firebase.storage();
    
    console.log('✅ Firebase initialized successfully');
  } else {
    console.log('✅ Firebase already initialized');
    app = firebase.apps[0];
    auth = firebase.auth();
    db = firebase.firestore();
    storage = firebase.storage();
  }
  
  return { app, auth, db, storage };
}

// Auth helpers
async function nbdSignIn(email, password) {
  try {
    const result = await auth.signInWithEmailAndPassword(email, password);
    return { success: true, user: result.user };
  } catch (error) {
    console.error('Sign in error:', error);
    return { success: false, error: error.message };
  }
}

async function nbdSignOut() {
  try {
    await auth.signOut();
    return { success: true };
  } catch (error) {
    console.error('Sign out error:', error);
    return { success: false, error: error.message };
  }
}

async function nbdSignUp(email, password, userData = {}) {
  try {
    const result = await auth.createUserWithEmailAndPassword(email, password);
    const userId = result.user.uid;
    
    // Create user document in Firestore
    await db.collection('users').doc(userId).set({
      email,
      role: userData.role || 'homeowner',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
      ...userData
    });
    
    return { success: true, user: result.user };
  } catch (error) {
    console.error('Sign up error:', error);
    return { success: false, error: error.message };
  }
}

async function nbdGetCurrentUser() {
  return new Promise((resolve) => {
    auth.onAuthStateChanged((user) => {
      resolve(user);
    });
  });
}

async function nbdGetUserRole(userId) {
  try {
    const doc = await db.collection('users').doc(userId).get();
    if (doc.exists) {
      return doc.data().role || 'homeowner';
    }
    return 'homeowner';
  } catch (error) {
    console.error('Get user role error:', error);
    return 'homeowner';
  }
}

// Firestore helpers
async function nbdCreateDocument(collection, data, docId = null) {
  try {
    const docRef = docId 
      ? db.collection(collection).doc(docId)
      : db.collection(collection).doc();
    
    await docRef.set({
      ...data,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    return { success: true, id: docRef.id };
  } catch (error) {
    console.error('Create document error:', error);
    return { success: false, error: error.message };
  }
}

async function nbdUpdateDocument(collection, docId, data) {
  try {
    await db.collection(collection).doc(docId).update({
      ...data,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    return { success: true };
  } catch (error) {
    console.error('Update document error:', error);
    return { success: false, error: error.message };
  }
}

async function nbdDeleteDocument(collection, docId) {
  try {
    // Soft delete (set deletedAt timestamp)
    await db.collection(collection).doc(docId).update({
      deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
      deleted: true
    });
    
    return { success: true };
  } catch (error) {
    console.error('Delete document error:', error);
    return { success: false, error: error.message };
  }
}

async function nbdGetDocument(collection, docId) {
  try {
    const doc = await db.collection(collection).doc(docId).get();
    if (doc.exists && !doc.data().deleted) {
      return { success: true, data: { id: doc.id, ...doc.data() } };
    }
    return { success: false, error: 'Document not found' };
  } catch (error) {
    console.error('Get document error:', error);
    return { success: false, error: error.message };
  }
}

async function nbdQueryDocuments(collection, filters = [], orderBy = null, limit = null) {
  try {
    let query = db.collection(collection).where('deleted', '==', false);
    
    // Apply filters
    filters.forEach(filter => {
      query = query.where(filter.field, filter.operator, filter.value);
    });
    
    // Apply ordering
    if (orderBy) {
      query = query.orderBy(orderBy.field, orderBy.direction || 'asc');
    }
    
    // Apply limit
    if (limit) {
      query = query.limit(limit);
    }
    
    const snapshot = await query.get();
    const documents = [];
    
    snapshot.forEach(doc => {
      documents.push({ id: doc.id, ...doc.data() });
    });
    
    return { success: true, data: documents };
  } catch (error) {
    console.error('Query documents error:', error);
    return { success: false, error: error.message };
  }
}

// Lead management helpers
async function nbdCreateLead(leadData) {
  return nbdCreateDocument('leads', {
    name: leadData.name || '',
    email: leadData.email || '',
    phone: leadData.phone || '',
    address: leadData.address || '',
    serviceType: leadData.serviceType || 'roof',
    source: leadData.source || 'website',
    status: 'new',
    notes: leadData.notes || '',
    visualizerData: leadData.visualizerData || null,
    assignedTo: leadData.assignedTo || null,
    lastContactedAt: null,
    emailSequenceStatus: 'active',
    deleted: false
  });
}

async function nbdUpdateLeadStatus(leadId, status) {
  return nbdUpdateDocument('leads', leadId, { status });
}

async function nbdGetLeadsByStatus(status) {
  return nbdQueryDocuments('leads', [
    { field: 'status', operator: '==', value: status }
  ], { field: 'createdAt', direction: 'desc' });
}

// Content management helpers
async function nbdCreateContent(contentData) {
  return nbdCreateDocument('content', {
    title: contentData.title,
    slug: contentData.slug || contentData.title.toLowerCase().replace(/\s+/g, '-'),
    type: contentData.type || 'blog',
    body: contentData.body || '',
    authorId: contentData.authorId,
    tags: contentData.tags || [],
    seoDescription: contentData.seoDescription || '',
    status: contentData.status || 'draft',
    publishDate: contentData.publishDate || null,
    viewCount: 0,
    shareCount: 0,
    deleted: false
  });
}

async function nbdPublishContent(contentId) {
  return nbdUpdateDocument('content', contentId, {
    status: 'published',
    publishDate: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function nbdGetPublishedContent(type = null, limit = 10) {
  const filters = [
    { field: 'status', operator: '==', value: 'published' }
  ];
  
  if (type) {
    filters.push({ field: 'type', operator: '==', value: type });
  }
  
  return nbdQueryDocuments('content', filters, 
    { field: 'publishDate', direction: 'desc' }, 
    limit
  );
}

// Expose all functions to window scope
window.initFirebase = initFirebase;
window.nbdSignIn = nbdSignIn;
window.nbdSignOut = nbdSignOut;
window.nbdSignUp = nbdSignUp;
window.nbdGetCurrentUser = nbdGetCurrentUser;
window.nbdGetUserRole = nbdGetUserRole;
window.nbdCreateDocument = nbdCreateDocument;
window.nbdUpdateDocument = nbdUpdateDocument;
window.nbdDeleteDocument = nbdDeleteDocument;
window.nbdGetDocument = nbdGetDocument;
window.nbdQueryDocuments = nbdQueryDocuments;
window.nbdCreateLead = nbdCreateLead;
window.nbdUpdateLeadStatus = nbdUpdateLeadStatus;
window.nbdGetLeadsByStatus = nbdGetLeadsByStatus;
window.nbdCreateContent = nbdCreateContent;
window.nbdPublishContent = nbdPublishContent;
window.nbdGetPublishedContent = nbdGetPublishedContent;

// Auto-initialize on load
document.addEventListener('DOMContentLoaded', () => {
  initFirebase();
});
