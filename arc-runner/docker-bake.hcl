target "default" {
  dockerfile = "Dockerfile"
  tags = ["ghcr.io/crisiscleanup/runner:v2.319.1"]
  platforms = ["linux/arm64"]
}
