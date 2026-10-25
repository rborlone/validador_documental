{{- define "vd.pdb" -}}
{{- if .Values.pdb.enabled }}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "vd.fullname" . }}
  labels: {{- include "vd.labels" . | nindent 4 }}
spec:
  minAvailable: {{ .Values.pdb.minAvailable }}
  selector:
    matchLabels: {{- include "vd.selectorLabels" . | nindent 6 }}
{{- end }}
{{- end -}}
