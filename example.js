# here's a comment
# multi-line

rule ZipCodes {
  conform length(5)
  conform type("string")
  conform allowedChars(Numeric)
}

rule Email {
}
