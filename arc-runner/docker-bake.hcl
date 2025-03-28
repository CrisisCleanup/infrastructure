target "default" {
  dockerfile = "Dockerfile"
  tags = ["ghcr.io/crisiscleanup/runner:v2.323.0"]
  platforms = ["linux/arm64"]
}
