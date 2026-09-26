"
I test the Pharo inspector extensions: each builds a Spec presenter from the fixture objects without opening a window.
"
Class {
	#name : 'TdInspectorTest',
	#superclass : 'TdTestCase',
	#category : 'TapeDeck-Tests',
	#package : 'TapeDeck-Tests'
}

{ #category : 'tests' }
TdInspectorTest >> testEveryInspectionIsDeclared [

	| selectors |
	selectors := (Pragma allNamed: #inspectorPresentationOrder:title:)
		             select: [ :each | each method methodClass instanceSide name beginsWith: 'Td' ]
		             thenCollect: [ :each | each method selector ].
	self assert: (selectors includesAll: #( #inspectionTimeline #inspectionHarnessDiff #inspectionRequest
			   #inspectionResponse #inspectionTools #inspectionRuns #inspectionRows ))
]

{ #category : 'tests' }
TdInspectorTest >> testInspectionsBuildPresenters [

	| step tape |
	step := self baseline stepAt: 4.
	tape := TdTape fromRun: self baseline.
	{
		self baseline inspectionTimeline.
		self fork inspectionHarnessDiff.
		step inspectionRequest.
		step inspectionResponse.
		step inspectionTools.
		step inspectionHarness.
		self store inspectionRuns.
		self store comparisonTable inspectionRows.
		self store comparisonTable inspectionSummary.
		tape inspectionSteps.
		tape inspectionJson.
		(self baseline harnessStateAt: 1) inspectionPrompt } do: [ :each |
		self assert: (each isKindOf: SpPresenter) ]
]

{ #category : 'tests' }
TdInspectorTest >> testTableColumnsShowText [
	"Every column of every table answers a string for every row."

	{
		self baseline inspectionTimeline.
		self fork inspectionTimeline.
		self fork inspectionHarnessDiff.
		(self baseline stepAt: 4) inspectionTools.
		(self baseline stepAt: 4) inspectionHarness.
		self store inspectionRuns.
		self store comparisonTable inspectionRows.
		(TdTape fromRun: self baseline) inspectionSteps } do: [ :table |
		self deny: table items isEmpty.
		table items do: [ :item |
			table columns do: [ :column | self assert: (column evaluation value: item) isString ] ] ]
]

{ #category : 'tests' }
TdInspectorTest >> testTablesShowTheObjects [

	self assert: self baseline inspectionTimeline items size equals: self baseline stepCount.
	self assert: self fork inspectionHarnessDiff items size equals: 1.
	self assert: self store inspectionRuns items size equals: self store size.
	self assert: ((self baseline stepAt: 4) inspectionResponse text includesSubstring: 'npm test')
]
