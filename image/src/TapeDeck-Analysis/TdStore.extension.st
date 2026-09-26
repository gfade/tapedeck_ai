Extension { #name : 'TdStore' }

{ #category : '*TapeDeck-Analysis' }
TdStore >> comparisonTable [
	"One row per fork in the store."

	^ TdComparisonTable forStore: self
]

{ #category : '*TapeDeck-Analysis' }
TdStore >> comparisonTableForCandidate: aCandidateName baseline: aBaselineName [

	^ TdComparisonTable forCandidate: aCandidateName baseline: aBaselineName in: self
]

{ #category : '*TapeDeck-Analysis' }
TdStore >> comparisonTableForReport: aReportName [
	"The gate report of that name, with its runs resolved in the store; nil if there is no such report."

	^ (self reportNamed: aReportName) ifNotNil: [ :report | TdComparisonTable fromGateReport: report in: self ]
]

{ #category : '*TapeDeck-Analysis' }
TdStore >> stats [

	^ TdStats on: self runs
]
