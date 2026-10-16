export const curatedSkills: { name: string; description: string; category: string; slug: string }[] = [
  { slug: 'code-review', name: 'Code Review', description: 'Review code for security, quality, and best practices.', category: 'developer' },
  { slug: 'git-workflow', name: 'Git Workflow', description: 'Git branching, commit conventions, PR workflow.', category: 'developer' },
  { slug: 'test-writing', name: 'Test Writing', description: 'Write unit and integration tests; TDD guidance.', category: 'developer' },
  { slug: 'api-design', name: 'API Design', description: 'Design RESTful APIs with OpenAPI spec and versioning.', category: 'developer' },
  { slug: 'social-media', name: 'Social Media', description: 'Draft and schedule social content for multiple platforms.', category: 'marketing' },
  { slug: 'copywriting', name: 'Copywriting', description: 'Write persuasive copy: headlines, CTAs, landing pages.', category: 'marketing' },
  { slug: 'seo-content', name: 'SEO Content', description: 'Optimize content for search: keywords, structure, linking.', category: 'marketing' },
  { slug: 'long-form-writing', name: 'Long-form Writing', description: 'Articles, essays, blog posts: structure and style.', category: 'writer' },
  { slug: 'technical-docs', name: 'Technical Docs', description: 'Developer documentation, README, API reference.', category: 'writer' },
  { slug: 'data-analysis', name: 'Data Analysis', description: 'Analyze data, identify trends, generate reports.', category: 'analyst' },
  { slug: 'market-research', name: 'Market Research', description: 'Research market trends, competitors, and opportunities.', category: 'analyst' },
  { slug: 'ci-cd', name: 'CI/CD', description: 'CI/CD pipeline setup, Docker, Kubernetes, deployments.', category: 'devops' },
  { slug: 'monitoring', name: 'Monitoring', description: 'Set up observability: metrics, logging, alerting.', category: 'devops' },
  { slug: 'security-audit', name: 'Security Audit', description: 'Security review: OWASP top 10, CVE scanning, pen test.', category: 'security' },
  { slug: 'deep-research', name: 'Deep Research', description: 'Synthesize sources, fact-check, and cite research thoroughly.', category: 'general' },
];

export function makeCuratedSkillMd(skill: { slug: string; name: string; description: string; category: string }): string {
  return `---\nname: "${skill.name}"\ndescription: "${skill.description}"\ncategory: "${skill.category}"\n---\n\n# ${skill.name}\n\n${skill.description}\n\nApply this skill to every relevant task. Follow best practices and be thorough.\n`;
}
