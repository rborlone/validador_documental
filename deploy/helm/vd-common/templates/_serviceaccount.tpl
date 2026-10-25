{{- define "vd.serviceaccount" -}}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "vd.fullname" . }}
  labels: {{- include "vd.labels" . | nindent 4 }}
  {{- with .Values.workloadIdentity }}
  {{- if .clientId }}
  annotations:
    azure.workload.identity/client-id: {{ .clientId | quote }}
  {{- end }}
  {{- end }}
{{- end -}}
