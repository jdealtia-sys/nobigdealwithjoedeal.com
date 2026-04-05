/**
 * NBD Brand — Homepage JavaScript
 * Loads header, footer, and blog posts
 */

// Load header component
fetch('/shared/components/header.html')
  .then(res => res.text())
  .then(html => {
    document.getElementById('header-container').innerHTML = html;
  })
  .catch(err => console.error('Error loading header:', err));

// Load footer component
fetch('/shared/components/footer.html')
  .then(res => res.text())
  .then(html => {
    document.getElementById('footer-container').innerHTML = html;
  })
  .catch(err => console.error('Error loading footer:', err));

// Load blog posts
async function loadBlogPosts() {
  try {
    // Get latest 3 published blog posts
    const result = await nbdGetPublishedContent('blog', 3);
    
    const blogContainer = document.getElementById('blogPosts');
    
    if (!result.success || result.data.length === 0) {
      // No posts yet - show placeholder
      blogContainer.innerHTML = `
        <div class="nbd-card" style="grid-column: 1 / -1; text-align: center; padding: var(--space-2xl);">
          <h3>Blog Coming Soon</h3>
          <p>Joe's writing some killer content. Check back soon for insights on roofing, contractor transparency, and industry secrets.</p>
        </div>
      `;
      return;
    }
    
    // Render blog posts
    blogContainer.innerHTML = result.data.map(post => {
      return nbdCreateCard({
        type: 'blog',
        title: post.title,
        description: post.seoDescription || nbdTruncate(post.body, 150),
        author: 'Joe Deal',
        date: post.publishDate,
        tags: post.tags.slice(0, 2), // Max 2 tags
        link: `/brand/blog/${post.slug}.html`,
        onclick: `window.location.href='/brand/blog/${post.slug}.html'`
      });
    }).join('');
    
  } catch (error) {
    console.error('Error loading blog posts:', error);
    document.getElementById('blogPosts').innerHTML = `
      <div class="nbd-card" style="grid-column: 1 / -1; text-align: center;">
        <p>Unable to load blog posts. Please try again later.</p>
      </div>
    `;
  }
}

// Wait for Firebase to initialize, then load blog posts
document.addEventListener('DOMContentLoaded', () => {
  // Firebase initializes automatically via firebase.js
  setTimeout(() => {
    loadBlogPosts();
  }, 500);
});
