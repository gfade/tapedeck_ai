Extension { #name : 'TdHarnessState' }

{ #category : '*TapeDeck-Inspector' }
TdHarnessState >> inspectionPrompt [

	<inspectorPresentationOrder: 1 title: 'Prompt'>
	^ SpTextPresenter new
		  text: self promptText;
		  beNotEditable;
		  yourself
]

{ #category : '*TapeDeck-Inspector' }
TdHarnessState >> inspectionSections [

	<inspectorPresentationOrder: 0 title: 'Sections and tools'>
	^ SpTablePresenter new
		  items: (self sections associations , self tools associations) asArray;
		  addColumn: (SpStringTableColumn title: 'Name' evaluated: [ :each | each key asString ]);
		  addColumn: (SpStringTableColumn title: 'Text' evaluated: [ :each |
					   TdText oneLine: (each value isDictionary
							    ifTrue: [ 'tool: ' , (each value at: 'description' ifAbsent: [ '' ]) asString ]
							    ifFalse: [ each value asString ])
						   max: 120 ]);
		  yourself
]
