{{- define "vd.networkpolicy" -}}
{{- if .Values.networkPolicy.enabled }}
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "vd.fullname" . }}
  labels: {{- include "vd.labels" . | nindent 4 }}
spec:
  podSelector:
    matchLabels: {{- include "vd.selectorLabels" . | nindent 6 }}
  policyTypes: ["Ingress"]
  ingress:
    {{- if or .Values.networkPolicy.allowFrom .Values.networkPolicy.allowNamespaceLabels }}
    - from:
        {{- range .Values.networkPolicy.allowFrom }}
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: {{ . }}
        {{- end }}
        {{- with .Values.networkPolicy.allowNamespaceLabels }}
        - namespaceSelector:
            matchLabels: {{- toYaml . | nindent 14 }}
        {{- end }}
    {{- end }}
{{- end }}
{{- end -}}
