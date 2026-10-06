const projectName = document.getElementById('project-name')
const reviewFocus = document.getElementById('review-focus')
const reviewButton = document.getElementById('review-summary')
const dialog = document.querySelector('dialog')
const summaryProject = document.getElementById('summary-project')
const summaryFocus = document.getElementById('summary-focus')
const closeButton = document.getElementById('close-dialog')
const themeToggle = document.getElementById('theme-toggle')

reviewButton.addEventListener('click', () => {
  summaryProject.textContent = projectName.value
  summaryFocus.textContent = reviewFocus.value
  dialog.showModal()
})

closeButton.addEventListener('click', () => {
  dialog.close()
})

themeToggle.addEventListener('click', () => {
  const darkThemeEnabled = document.documentElement.dataset.theme !== 'dark'

  if (darkThemeEnabled) {
    document.documentElement.dataset.theme = 'dark'
  } else {
    delete document.documentElement.dataset.theme
  }

  themeToggle.setAttribute('aria-pressed', String(darkThemeEnabled))
  themeToggle.textContent = darkThemeEnabled ? 'Use light theme' : 'Use dark theme'
})
