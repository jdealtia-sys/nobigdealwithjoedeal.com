// Load components
fetch('/shared/components/header.html').then(r => r.text()).then(h => document.getElementById('header-container').innerHTML = h);
fetch('/shared/components/footer.html').then(r => r.text()).then(h => document.getElementById('footer-container').innerHTML = h);

// Load blog posts
async function loadPosts() {
  try {
    const result = await nbdGetPublishedContent('blog', 20);
    const container = document.getElementById('blogPosts');
    
    if (!result.success || result.data.length === 0) {
      container.innerHTML = `
        <div class="nbd-card" style="grid-column: 1 / -1; text-align: center; padding: var(--space-2xl);">
          <h2>Coming Soon</h2>
          <p>Joe's writing killer content. Check back soon for roofing insights, contractor secrets, and industry transparency.</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = result.data.map(post => nbdCreateCard({
      type: 'blog',
      title: post.title,
      description: post.seoDescription || nbdTruncate(post.body, 150),
      author: 'Joe Deal',
      date: post.publishDate,
      tags: post.tags.slice(0, 2),
      link: `/brand/blog/${post.slug}.html`,
      onclick: `window.location.href='/brand/blog/${post.slug}.html'`
    })).join('');
    
  } catch (error) {
    console.error('Error loading posts:', error);
    document.getElementById('blogPosts').innerHTML = '<p>Unable to load posts.</p>';
  }
}

document.addEventListener('DOMContentLoaded', () => setTimeout(loadPosts, 500));
